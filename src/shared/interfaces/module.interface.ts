export interface Module {
  id: string;
  name: string;
  path: string;
  repositoryId: string;
  content?: string;
  size?: number;
  imports?: string[];
  createdAt: Date;
}
