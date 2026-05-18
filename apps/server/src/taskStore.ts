import type { GenerationTask } from "../../../packages/shared/src/index.ts";

export class TaskStore {
  private readonly tasks = new Map<string, GenerationTask>();

  save(task: GenerationTask): GenerationTask {
    this.tasks.set(task.id, task);
    return task;
  }

  get(taskId: string): GenerationTask | undefined {
    return this.tasks.get(taskId);
  }

  selectResult(taskId: string, resultId: string): GenerationTask | undefined {
    const task = this.tasks.get(taskId);

    if (!task) {
      return undefined;
    }

    const updatedTask: GenerationTask = {
      ...task,
      selectedResultId: resultId,
      updatedAt: new Date().toISOString(),
      results: task.results.map((result) => ({
        ...result,
        selected: result.id === resultId,
      })),
    };

    this.tasks.set(taskId, updatedTask);
    return updatedTask;
  }
}
