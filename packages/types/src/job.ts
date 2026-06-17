export type Job = {
  id: string;
  organizationId: string;
  title: string;
  location?: string;
  description: string;
  createdAt: Date;
};
