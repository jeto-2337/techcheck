export type VerdictType = 'supported' | 'doubtful' | 'misleading';
export type InputType = 'url' | 'text';
export type UserRole = 'admin' | 'user';

export interface ClaimItem {
  id: string;
  statement: string;
  status: VerdictType;
  explanation: string;
  sourceRefs: number[];
}

export interface SourceItem {
  index: number;
  title: string;
  url: string;
  domain: string;
}

export interface AnalysisRecord {
  id: string;
  title: string;
  inputType: InputType;
  sourceContent: string;
  verdict: VerdictType;
  summary: string;
  claims: ClaimItem[];
  sources: SourceItem[];
  createdAt: string;
  isFavorite: boolean;
  deletedAt: string | null;
  pendingSync?: boolean;
  authorUsername?: string | null;
  verifiedBy?: string | null;
  verifiedAt?: string | null;
  adminNote?: string | null;
}
