export type JobState = {
  step: number;
  label: string;
  done: boolean;
  error?: string;
};

export const jobs = new Map<string, JobState>();
