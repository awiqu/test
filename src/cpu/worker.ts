import { ComputerProject } from '../computer/types';
import { ComputerBuildError, ComputerExportSettings, exportComputer } from './computerExport';
import { BuildOutput, toBuildOutput } from './buildResult';

export interface BuildRequest {
  id: number;
  project: ComputerProject;
  settings: ComputerExportSettings;
}

export type BuildResponse =
  | { id: number; type: 'progress'; message: string }
  | { id: number; type: 'result'; result: BuildOutput }
  | { id: number; type: 'error'; message: string; issues: string[] };

self.onmessage = (e: MessageEvent<BuildRequest>) => {
  const { id, project, settings } = e.data;
  const post = (m: BuildResponse): void => (self as unknown as Worker).postMessage(m);
  try {
    const result = toBuildOutput(exportComputer(project, settings, (message) => post({ id, type: 'progress', message })));
    post({ id, type: 'result', result });
  } catch (err) {
    post({ id, type: 'error', message: err instanceof Error ? err.message : String(err), issues: err instanceof ComputerBuildError ? err.issues : [] });
  }
};
