export type Viewer = { email: string; role: "admin" | "member" };
export type Asset = { id: string; name: string; url: string; mime: string };
export type VisualObservation = Partial<
  Record<"light" | "color" | "texture" | "framing", string>
>;
export type Source = {
  id: string;
  kind: "url" | "pdf" | "mood" | "memo";
  name: string;
  url?: string;
  text?: string;
  asset?: Asset;
  observation?: VisualObservation;
  referenceRole?: "base" | "prefer" | "avoid";
  referenceNumber?: number;
};
export type Claim = {
  id: string;
  kind: "전망" | "런웨이 관찰" | "실측" | "자료 관찰";
  fact: string;
  excerpt?: string;
  sourceTitle: string;
  url?: string;
  sourceId?: string;
  page?: number;
  date?: string;
  period?: string;
  region?: string;
  unit?: string;
  verified: boolean;
};
export type VisualReference = {
  title: string;
  url: string;
  observation: string;
  pinterestImage?: Asset;
};
export type Plan = {
  referenceIds?: string[];
  visualReferences?: VisualReference[];
  title: string;
  theme: string;
  reason: string;
  scene: string;
  subject: string;
  material: string;
  light: string;
  framing: string;
  logoProcess: string;
  logoPlacement?: string;
  logoDetail?: string;
  reviewNote?: string;
  mood: string;
  genre: string;
  prompt: string;
  claims: Claim[];
};
export type Version = {
  id: string;
  image: Asset;
  createdAt: string;
  status: "pending" | "adopted" | "held";
  note: string;
  prompt: string;
  model: string;
  plan: Plan;
  logoId: string;
  sourceIds: string[];
  workflowId: string;
  refinement?: string;
  baseVersionId?: string;
  imageReferenceIds?: string[];
};
export type Shot = {
  id: string;
  number: number;
  plan: Plan;
  versions: Version[];
  adoptedId?: string;
};
export type Project = {
  id: string;
  name: string;
  keyword: string;
  season: string;
  count: number;
  sources: Source[];
  workflowId: string;
  logoId: string;
  shots: Shot[];
  createdAt: string;
  createdBy: string;
  sample?: boolean;
  quick?: boolean;
  pinterestReferences?: number;
  lastShotNumber?: number;
};
export type Job = {
  id: string;
  kind: "research" | "generate";
  projectId: string;
  shotId?: string;
  key: string;
  retryKeys?: string[];
  status: "queued" | "running" | "succeeded" | "failed";
  error?: string;
  createdAt: string;
  input?: {
    plan: Plan;
    logoId: string;
    sourceIds: string[];
    workflowId: string;
    refinement?: string;
    baseVersionId?: string;
  };
};
export type Workflow = {
  id: string;
  name: string;
  text: string;
  createdAt: string;
};
export type Logo = {
  id: string;
  name: string;
  official: boolean;
  asset: Asset;
};
export type Board = {
  id: string;
  name: string;
  versionIds: string[];
  updatedAt: string;
};
export type StudioState = {
  projects: Project[];
  jobs: Job[];
  workflows: Workflow[];
  logos: Logo[];
  boards: Board[];
};
export type StudioPayload = {
  state: StudioState;
  viewer: Viewer;
  mode: "local" | "team";
  aiReady: boolean;
};
export type Action =
  | {
      type: "createProject";
      id: string;
      name: string;
      keyword: string;
      season: string;
      count: number;
      sources: Source[];
      logoId: string;
      research?: boolean;
      quick?: boolean;
    }
  | { type: "research"; projectId: string; key: string }
  | { type: "sources"; projectId: string; sources: Source[] }
  | { type: "deleteProject"; projectId: string }
  | { type: "deleteShot"; projectId: string; shotId: string }
  | { type: "addShot"; projectId: string; plan: Plan; number?: number }
  | { type: "editPlan"; projectId: string; shotId: string; plan: Plan }
  | { type: "generate"; projectId: string; shotIds: string[]; key: string }
  | {
      type: "refineShot";
      projectId: string;
      shotId: string;
      versionId: string;
      instruction: string;
      key: string;
    }
  | { type: "retry"; jobId: string; key: string }
  | {
      type: "review";
      projectId: string;
      shotId: string;
      versionId: string;
      status: "adopted" | "held";
      note: string;
    }
  | {
      type: "uploadVersion";
      projectId: string;
      shotId: string;
      asset: Asset;
      note: string;
    }
  | { type: "workflow"; name: string; text: string }
  | { type: "logo"; name: string; asset: Asset; official: boolean }
  | {
      type: "board";
      id: string;
      name: string;
      versionIds: string[];
      baseUpdatedAt?: string;
    };
export type JobResult =
  | { kind: "research"; plans: Plan[]; pinterestReferences?: number }
  | {
      kind: "generate";
      image: Asset;
      model: string;
      executionPrompt?: string;
      imageReferenceIds?: string[];
    };
export type StudioClient = {
  data: StudioPayload;
  act: (action: Action) => Promise<boolean>;
  upload: (file: File) => Promise<Asset>;
  notify: (message: string) => void;
};
