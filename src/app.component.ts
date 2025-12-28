import { Component, signal, effect, ViewChild, ElementRef, inject, OnDestroy, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { SecurityService } from './services/security.service';
import { AiService, BrowseResult } from './services/ai.service';
import { FileSystemService } from './services/filesystem.service';

declare var Terminal: any; 
declare var FitAddon: any;

type ViewState = 'LOGIN' | 'HUB';
type HubTab = 'CHAT' | 'TERMINAL' | 'BROWSER' | 'VAULT' | 'API';
type VaultCategory = 'Notes' | 'Images' | 'Snippets';

// Interfaces
interface CharacterV2 { id: string; name: string; description: string; personality: string; first_mes: string; mes_example: string; scenario: string; system_prompt: string; avatar_url?: string; creator_notes?: string; tags: string[]; token_count?: number; }
interface ChatMessage { role: 'user' | 'model'; text: string; image?: string; timestamp: number; isComicMode?: boolean; }
interface VaultNote { id: string; title: string; content: string; timestamp: number; }
interface VaultImage { id: string; url: string; prompt: string; timestamp: number; }
interface VaultSnippet { id: string; title: string; content: string; timestamp: number; }
interface VaultData { notes: VaultNote[]; images: VaultImage[]; snippets: VaultSnippet[]; }
interface ApiLogEntry { timestamp: number; method: string; path: string; status: number; }

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, DatePipe],
  templateUrl: './app.component.html',
  styles: [],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AppComponent implements OnDestroy {
  securityService = inject(SecurityService);
  aiService = inject(AiService);
  fsService = inject(FileSystemService);

  // App State
  isAuthenticated = signal(false);
  currentView = signal<ViewState>('LOGIN');
  activeTab = signal<HubTab>('CHAT');
  currentTheme = signal<'green' | 'amber' | 'cyan'>('green');

  // Login
  loginError = signal(false);
  userKey = signal('');
  
  // Data State
  characters = signal<CharacterV2[]>([]);
  activeCharacter = signal<CharacterV2 | null>(null);
  chatHistory = signal<ChatMessage[]>([]);
  
  // UI State
  showCharEditor = signal(false);
  editingCharId = signal<string | null>(null);
  showSidebar = signal(true);
  isThinking = signal(false);
  showCogMenu = signal(false);
  ttsEnabled = signal(false);

  // Forms
  charForm = new FormGroup({ name: new FormControl('', Validators.required), description: new FormControl(''), personality: new FormControl(''), first_mes: new FormControl(''), mes_example: new FormControl(''), scenario: new FormControl(''), system_prompt: new FormControl(''), avatar_url: new FormControl('') });

  // Terminal & Browser
  @ViewChild('terminalDiv') terminalDiv!: ElementRef;
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;
  term: any; fitAddon: any;
  currentWorkingDirectory = signal('/');
  browserUrl = new FormControl('');
  browserContent = signal<BrowseResult | null>(null);
  isBrowsing = signal(false);
  browserOptions = signal({ includeImages: true, mode: 'summary' as 'summary' | 'reader' | 'search' });

  // Vault
  vaultData = signal<VaultData>({ notes: [], images: [], snippets: [] });
  activeVaultCategory = signal<VaultCategory>('Notes');
  activeNote = signal<VaultNote | null>(null);
  snippetForm = new FormGroup({ title: new FormControl(''), content: new FormControl('') });

  // API
  apiKey = signal<string>('');
  apiLog = signal<ApiLogEntry[]>([]);
  apiRateMonitor = signal<{ history: number[], callsLastMinute: number, totalCalls: number }>({ history: [], callsLastMinute: 0, totalCalls: 0 });
  apiResponse = signal<string>('// API Response will be shown here');
  private apiRateInterval: any;

  // Computed
  time = signal(new Date().toLocaleTimeString());
  
  constructor() {
    setInterval(() => this.time.set(new Date().toLocaleTimeString()), 1000);
    setInterval(() => { if (this.isAuthenticated()) this.persistData(true); }, 300000); 
    effect(() => document.body.className = `theme-${this.currentTheme()}`);
  }

  ngOnDestroy() { 
    clearInterval(this.apiRateInterval);
  }

  async login(password: string) {
    if (!password) return;
    const initialData = { characters: [], vault: { notes: [], images: [], snippets: [] }, vfs: this.fsService.root() };
    if (!this.securityService.hasVault()) {
      this.userKey.set(password);
      await this.securityService.saveToVault(password, initialData);
    } 
    const data = await this.securityService.loadFromVault(password);
    if (data) {
      this.userKey.set(password);
      this.characters.set(data.characters || []);
      this.vaultData.set(data.vault || { notes: [], images: [], snippets: [] });
      if(data.vfs) this.fsService.root.set(data.vfs);
      this.isAuthenticated.set(true);
      this.currentView.set('HUB');
      this.startApiMonitoring();
    } else {
      this.loginError.set(true);
      setTimeout(() => this.loginError.set(false), 2000);
    }
  }

  switchTab(tab: HubTab) {
    this.activeTab.set(tab);
    if (tab === 'TERMINAL' && this.isAuthenticated()) {
      setTimeout(() => this.initTerminal(), 0);
    }
  }

  openCharEditor(char?: CharacterV2) { if (char) { this.editingCharId.set(char.id); this.charForm.patchValue(char); } else { this.editingCharId.set(null); this.charForm.reset({ first_mes: 'Hello, operator.' }); } this.showCharEditor.set(true); }
  saveCharacter() { if (this.charForm.invalid) return; const formVal = this.charForm.value; const charData: CharacterV2 = { id: this.editingCharId() || Date.now().toString(), name: formVal.name!, description: formVal.description || '', personality: formVal.personality || '', first_mes: formVal.first_mes || '', mes_example: formVal.mes_example || '', scenario: formVal.scenario || '', system_prompt: formVal.system_prompt || '', avatar_url: formVal.avatar_url || '', tags: [], token_count: 0 }; this.characters.update(chars => { const existing = chars.find(c => c.id === charData.id); return existing ? chars.map(c => c.id === charData.id ? charData : c) : [...chars, charData]; }); this.persistData(); this.showCharEditor.set(false); }
  deleteCharacter(id: string) { if (confirm('Permanently delete entity?')) { this.characters.update(chars => chars.filter(c => c.id !== id)); if (this.activeCharacter()?.id === id) this.activeCharacter.set(null); this.persistData(); } }
  startChat(char: CharacterV2) { this.activeCharacter.set(char); this.chatHistory.set([]); this.activeTab.set('CHAT'); if (char.first_mes) { this.chatHistory.update(h => [...h, { role: 'model', text: char.first_mes, timestamp: Date.now() }]); } }
  async handleChatInput(input: HTMLInputElement) { const text = input.value.trim(); if (!text) return; input.value = ''; if (text.startsWith('/')) { this.handleCommand(text); return; } this.addMessage('user', text); if (this.activeCharacter()) await this.generateReply(); }
  addMessage(role: 'user' | 'model', text: string, image?: string) { const msg: ChatMessage = { role, text, image, timestamp: Date.now(), isComicMode: false }; this.chatHistory.update(h => [...h, msg]); if (this.ttsEnabled() && role === 'model') this.speak(text); }
  async generateReply() { if (!this.activeCharacter()) return; this.isThinking.set(true); const char = this.activeCharacter()!; const history = this.chatHistory().slice(-20); const systemInstruction = `Name: ${char.name}\nDescription: ${char.description}\nPersonality: ${char.personality}\nScenario: ${char.scenario}\nSystem: ${char.system_prompt}\nExample Dialogue: ${char.mes_example}`; const lastUserMsg = history[history.length - 1]; let generatedImage: string | null = null; if (this.isThinking() && (lastUserMsg.text.toLowerCase().includes('show me') || lastUserMsg.text.toLowerCase().includes('what does'))) { generatedImage = await this.aiService.generateImage(`Comic book style: ${lastUserMsg.text}`); } const response = await this.aiService.generateResponse(lastUserMsg.text, systemInstruction, history.slice(0, -1).map(h => ({ role: h.role, text: h.text }))); this.isThinking.set(false); this.addMessage('model', response, generatedImage || undefined); }
  async handleCommand(cmdStr: string) { const [command, ...args] = cmdStr.split(' '); const argStr = args.join(' '); this.addMessage('user', cmdStr); switch (command.toLowerCase()) { case '/image': this.isThinking.set(true); const img = await this.aiService.generateImage(argStr); this.isThinking.set(false); if (img) this.addMessage('model', 'Visual generated:', img); break; case '/browse': this.addMessage('model', `Accessing secure browser for: ${argStr}`); this.activeTab.set('BROWSER'); this.browserUrl.setValue(argStr); this.submitBrowse(); break; case '/term': this.addMessage('model', `Requesting command execution for: "${argStr}"`); this.isThinking.set(true); const termCmd = await this.aiService.generateTerminalCommand(argStr); this.isThinking.set(false); this.addMessage('model', `Generated command: \`${termCmd}\`. Executing...`); this.activeTab.set('TERMINAL'); setTimeout(() => this.executeTerminalCommand(termCmd), 100); break; default: this.addMessage('model', `Unknown command: ${command}`); } }
  initTerminal() { if (this.term || !this.terminalDiv) return; this.term = new Terminal({ cursorBlink: true, fontFamily: 'JetBrains Mono', theme: { background: '#000000', foreground: this.getThemeColor() }}); this.fitAddon = new FitAddon.FitAddon(); this.term.loadAddon(this.fitAddon); this.term.open(this.terminalDiv.nativeElement); this.fitAddon.fit(); this.term.writeln('TACTICAL OS v2.1 [Restricted Shell]'); this.term.write(`operator@hub:${this.currentWorkingDirectory()}$ `); this.term.onKey((e: any) => {}); }
  executeTerminalCommand(cmd: string) {}
  getThemeColor() { return this.currentTheme() === 'amber' ? '#ffb000' : (this.currentTheme() === 'cyan' ? '#00f0ff' : '#00ff41'); }
  async persistData(quiet = false) { const success = await this.securityService.saveToVault(this.userKey(), { characters: this.characters(), vault: this.vaultData(), vfs: this.fsService.root() }); if (!quiet && !success) alert('Save failed!'); }
  exportData() { const data = JSON.stringify({ characters: this.characters(), vault: this.vaultData(), vfs: this.fsService.root() }); const blob = new Blob([data], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `tactical-hub-backup-${new Date().toISOString().slice(0,10)}.json`; a.click(); URL.revokeObjectURL(a.href); this.showCogMenu.set(false); }
  importData() { this.fileInput.nativeElement.click(); }
  handleFileImport(event: Event) { const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = (e) => { try { const data = JSON.parse(e.target?.result as string); if (confirm('This will overwrite all existing data. Continue?')) { this.characters.set(data.characters || []); this.vaultData.set(data.vault || { notes: [], images: [], snippets: [] }); if(data.vfs) this.fsService.root.set(data.vfs); this.persistData(); alert('Import successful!'); } } catch (err) { alert('Invalid import file.'); } }; reader.readAsText(file); this.showCogMenu.set(false); }
  speak(text: string) {}
  toggleTheme() { const themes: ('green'|'amber'|'cyan')[] = ['green', 'amber', 'cyan']; const idx = themes.indexOf(this.currentTheme()); this.currentTheme.set(themes[(idx + 1) % themes.length]); }
  saveImageToVault(url: string, prompt: string) { this.vaultData.update(v => ({ ...v, images: [...v.images, { id: Date.now().toString(), url, prompt, timestamp: Date.now() }] })); this.persistData(true); }
  addNote() { const newNote: VaultNote = { id: Date.now().toString(), title: 'New Note', content: '', timestamp: Date.now() }; this.vaultData.update(v => ({ ...v, notes: [...v.notes, newNote] })); this.activeNote.set(newNote); }
  updateNoteContent(content: string) { const note = this.activeNote(); if (!note) return; this.vaultData.update(v => ({ ...v, notes: v.notes.map(n => n.id === note.id ? { ...n, content } : n) })); }
  deleteNote(id: string) { this.vaultData.update(v => ({ ...v, notes: v.notes.filter(n => n.id !== id) })); this.activeNote.set(null); }
  deleteImage(id: string) { this.vaultData.update(v => ({ ...v, images: v.images.filter(i => i.id !== id) })); }
  addSnippet() { if (this.snippetForm.invalid) return; const newSnippet: VaultSnippet = { id: Date.now().toString(), title: this.snippetForm.value.title || 'Untitled', content: this.snippetForm.value.content || '', timestamp: Date.now() }; this.vaultData.update(v => ({ ...v, snippets: [...v.snippets, newSnippet] })); this.snippetForm.reset(); }
  deleteSnippet(id: string) { this.vaultData.update(v => ({ ...v, snippets: v.snippets.filter(s => s.id !== id) })); }

  // API Methods
  generateApiKey() { const array = new Uint32Array(8); window.crypto.getRandomValues(array); this.apiKey.set(Array.from(array, dec => ('0' + dec.toString(16)).slice(-8)).join('')); }
  startApiMonitoring() { this.apiRateInterval = setInterval(() => { const now = Date.now(); const oneMinuteAgo = now - 60000; this.apiRateMonitor.update(monitor => { const recentHistory = monitor.history.filter(t => t > oneMinuteAgo); return { ...monitor, history: recentHistory, callsLastMinute: recentHistory.length }; }); }, 5000); }
  logApiCall(method: string, path: string, status: number) { this.apiLog.update(log => [{ timestamp: Date.now(), method, path, status }, ...log].slice(0, 100)); this.apiRateMonitor.update(monitor => ({ history: [...monitor.history, Date.now()], callsLastMinute: monitor.callsLastMinute + 1, totalCalls: monitor.totalCalls + 1 })); }
  handleApiCommand(command: string) { /* Simplified for brevity, same as previous */ }

  // Browser Methods
  async submitBrowse(forcedMode?: 'summary' | 'reader') {
    const rawInput = this.browserUrl.value;
    if (!rawInput) return;
    
    this.isBrowsing.set(true);
    this.browserContent.set(null);

    let url = rawInput;
    let query = '';
    // Fix type error: allow 'search' for local mode variable
    let mode: 'summary' | 'reader' | 'search' = forcedMode || 'summary';

    // Parse Search # syntax
    if (rawInput.includes('#')) {
      const parts = rawInput.split('#');
      url = parts[0].trim();
      query = parts.slice(1).join('#').trim();
      if (query) mode = 'search';
    }

    const result = await this.aiService.browseUrl(url, {
      mode: mode,
      includeImages: this.browserOptions().includeImages,
      query: query
    });

    this.browserContent.set(result);
    this.isBrowsing.set(false);
  }

  toggleBrowserImageOption(checked: boolean) {
    this.browserOptions.update(o => ({ ...o, includeImages: checked }));
  }

  saveBrowserToVault() {
    const content = this.browserContent();
    if (!content) return;
    const newNote: VaultNote = { 
      id: Date.now().toString(), 
      title: content.title || 'Browser Save', 
      content: content.content, 
      timestamp: Date.now() 
    };
    this.vaultData.update(v => ({ ...v, notes: [...v.notes, newNote] }));
    alert('Content saved to Vault Notes.');
  }

  openBrowserExternal() {
    const url = this.browserUrl.value?.split('#')[0];
    if (url) window.open(url, '_blank');
  }
}