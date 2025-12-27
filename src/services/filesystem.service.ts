
import { Injectable, signal } from '@angular/core';

export interface VirtualFile {
  name: string;
  content: string;
  type: 'file' | 'dir';
  permissions: string;
  owner: string;
  children?: VirtualFile[];
}

@Injectable({
  providedIn: 'root'
})
export class FileSystemService {
  root = signal<VirtualFile>({
    name: 'root',
    content: '',
    type: 'dir',
    permissions: 'rwxr-xr-x',
    owner: 'system',
    children: [
      { name: 'logs', type: 'dir', permissions: 'rwxr--r--', owner: 'system', content: '', children: [] },
      { name: 'notes', type: 'dir', permissions: 'rwxr-xr-x', owner: 'user', content: '', children: [] },
      { name: 'readme.txt', type: 'file', permissions: 'r--r--r--', owner: 'system', content: 'Welcome to the Tactical OS Virtual Filesystem.', children: [] }
    ]
  });

  private findNode(path: string): { parent: VirtualFile | null, node: VirtualFile | null, nodeName: string } {
    const parts = path.split('/').filter(p => p);
    let currentNode: VirtualFile = this.root();
    let parentNode: VirtualFile | null = null;

    if (path === '/') return { parent: null, node: this.root(), nodeName: '' };
    if (parts.length === 0) return { parent: null, node: this.root(), nodeName: '' };

    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (currentNode.type !== 'dir' || !currentNode.children) {
            return { parent: null, node: null, nodeName: '' }; // Invalid path
        }
        const found = currentNode.children.find(c => c.name === part);
        if (!found) {
            if (i === parts.length - 1) { // Not found, but it's the target
                return { parent: currentNode, node: null, nodeName: part };
            }
            return { parent: null, node: null, nodeName: '' }; // Path doesn't exist
        }
        parentNode = currentNode;
        currentNode = found;
    }
    return { parent: parentNode, node: currentNode, nodeName: parts[parts.length - 1] };
  }
  
  resolvePath(path: string, cwd: string): string {
    if (path.startsWith('/')) return path; // Absolute path
    const newPath = `${cwd}/${path}`.replace(/\/+/g, '/');
    const parts = newPath.split('/');
    const resolved: string[] = [];
    for (const part of parts) {
        if (part === '.' || part === '') continue;
        if (part === '..') {
            resolved.pop();
        } else {
            resolved.push(part);
        }
    }
    return '/' + resolved.join('/');
  }

  list(path: string): VirtualFile[] | null {
    const { node } = this.findNode(path);
    if (node && node.type === 'dir') {
        return node.children || [];
    }
    return null;
  }
  
  createFile(path: string, content = ''): boolean {
    const { parent, node, nodeName } = this.findNode(path);
    if (parent && !node) {
        this.root.update(r => {
            const { node: parentInTree } = this.findNode(path.substring(0, path.lastIndexOf('/')) || '/');
            if(parentInTree && parentInTree.children) {
                parentInTree.children.push({ name: nodeName, type: 'file', content, permissions: 'rw-r--r--', owner: 'user' });
            }
            return {...r};
        });
        return true;
    }
    return false;
  }
  
  createDirectory(path: string): boolean {
     const { parent, node, nodeName } = this.findNode(path);
    if (parent && !node) {
        this.root.update(r => {
            const { node: parentInTree } = this.findNode(path.substring(0, path.lastIndexOf('/')) || '/');
            if (parentInTree && parentInTree.children) {
                parentInTree.children.push({ name: nodeName, type: 'dir', content: '', permissions: 'rwxr-xr-x', owner: 'user', children: [] });
            }
            return {...r};
        });
        return true;
    }
    return false;
  }
  
  readFile(path: string): string | null {
      const { node } = this.findNode(path);
      if (node && node.type === 'file') return node.content;
      return null;
  }
  
  updateFile(path: string, content: string): boolean {
      const { node } = this.findNode(path);
      if (node && node.type === 'file') {
          this.root.update(r => {
              const { node: fileInTree } = this.findNode(path);
              if (fileInTree) fileInTree.content = content;
              return {...r};
          });
          return true;
      } else if (!node) {
          return this.createFile(path, content);
      }
      return false;
  }
  
  delete(path: string): boolean {
      const { parent, node } = this.findNode(path);
      if (parent && node) {
          this.root.update(r => {
              const { parent: parentInTree } = this.findNode(path);
              if (parentInTree && parentInTree.children) {
                  parentInTree.children = parentInTree.children.filter(c => c.name !== node.name);
              }
              return {...r};
          });
          return true;
      }
      return false;
  }
}
