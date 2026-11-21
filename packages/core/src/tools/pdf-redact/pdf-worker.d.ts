declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: {
    initializeFromPort(port: MessagePort): void;
  };
}
