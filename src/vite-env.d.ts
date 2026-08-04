/// <reference types="vite/client" />

// Vite's ambient declarations for the non-JS things a module can import — the
// `import './index.css'` in main.tsx, plus `?url` / `?raw` / `?worker` suffixes.
// TypeScript 5 quietly allowed a side-effect import of an unknown module;
// TypeScript 7 requires a declaration for it (TS2882), so this is no longer
// optional scaffolding.
