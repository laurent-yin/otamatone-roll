/// <reference types="vite/client" />

declare module '*.abc?raw' {
  const content: string;
  export default content;
}
