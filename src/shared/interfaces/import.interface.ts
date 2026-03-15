export interface Import {
  id: string;
  sourceModuleId: string;
  targetModuleId: string;
  importType: 'relative' | 'absolute' | 'external';
  importLine?: number;
  createdAt: Date;
}
