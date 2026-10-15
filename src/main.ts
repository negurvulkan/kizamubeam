import './style.css';
import { Editor } from './editor';
import { buildUI } from './ui';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
canvas.tabIndex = 0;
const editor = new Editor(canvas);
buildUI(editor);
editor.setTool('select');
// Für Tests und Fehlersuche in der Konsole erreichbar
(window as unknown as { editor: Editor }).editor = editor;
