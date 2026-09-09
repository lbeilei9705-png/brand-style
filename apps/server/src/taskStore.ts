import type { GenerationTask } from "../../../packages/shared/src/index.ts";

export class TaskStore {
  private readonly tasks = new Map<string, GenerationTask>();
  private readonly maximumTasks: number;

  constructor(maximumTasks = 12) {
    this.maximumTasks = maximumTasks;
  }

  save(task: GenerationTask): GenerationTask {
    this.tasks.delete(task.id);
    this.tasks.set(task.id, task);
    while (this.tasks.size > Math.max(1, this.maximumTasks)) {
      const oldestTaskId = this.tasks.keys().next().value;
      if (!oldestTaskId) break;
      this.tasks.delete(oldestTaskId);
    }
    return task;
  }

  get(taskId: string): GenerationTask | undefined {
    return this.tasks.get(taskId);
  }

  selectResult(taskId: string, resultId: string): GenerationTask | undefined {
    const task = this.tasks.get(taskId);

    if (!task || !task.results.some((result) => result.id === resultId)) {
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
