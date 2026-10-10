// Data access for grey.eval_sets, grey.eval_cases, grey.eval_runs — evaluation suites and their runs.
import { makeRepo } from "./repository";

const setColumns = ["name", "description", "metadata"];
const caseColumns = ["evalSetId", "question", "expectedAnswer", "expectedSourceIds", "metadata"];
const runColumns = ["evalSetId", "pipelineId", "pipelineVersion", "status", "metrics", "metadata"];

const setRepo = makeRepo({ table: "eval_sets", columns: setColumns });
const caseRepo = makeRepo({ table: "eval_cases", columns: caseColumns });
const runRepo = makeRepo({ table: "eval_runs", columns: runColumns });

export const listEvalSets = (projectId) => setRepo.list(projectId);
export const createEvalSet = (projectId, input) => setRepo.create(projectId, input);
export const updateEvalSet = (id, patch) => setRepo.update(id, patch);
export const deleteEvalSet = (id) => setRepo.remove(id);

export const listEvalCases = (projectId, evalSetId) => caseRepo.list(projectId, { evalSetId });
export const createEvalCase = (projectId, input) => caseRepo.create(projectId, input);
export const updateEvalCase = (id, patch) => caseRepo.update(id, patch);
export const deleteEvalCase = (id) => caseRepo.remove(id);

export const listEvalRuns = (projectId, filters = {}) => runRepo.list(projectId, filters);
export const createEvalRun = (projectId, input) => runRepo.create(projectId, input);
