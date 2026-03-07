declare global {
  interface Window {
    memoryQuiz: import('./lib/types/ipc').MemoryQuizApi;
  }
}

export {};
