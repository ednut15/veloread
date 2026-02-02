export type SourceType = 'txt' | 'epub';

export interface BookMeta {
  id: string;
  title: string;
  sourceType: SourceType;
  createdAt: number;
  updatedAt: number;
  textLength: number;
  tokenCount: number;
  chunkSize: number;
  chunkCount: number;
  preview: string;
  lastOpenedAt?: number;
}

export interface ReadingState {
  bookId: string;
  index: number;
  wpm: number;
  orpEnabled: boolean;
  punctuationPauses: boolean;
  lastReadAt: number;
}

export interface GlobalSettings {
  defaultWpm: number;
  defaultOrpEnabled: boolean;
  defaultPunctuationPauses: boolean;
}

export interface ImportProgress {
  phase: 'reading' | 'tokenizing' | 'saving';
  progress: number;
}
