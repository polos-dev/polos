/**
 * Workflow registry for tracking registered workflows.
 *
 * Used by Worker to find workflows to execute based on workflow ID.
 */

import type { Workflow } from '../types/workflow.js';

/**
 * Error thrown when a workflow is not found in the registry.
 */
export class WorkflowNotFoundError extends Error {
  constructor(public readonly workflowId: string) {
    super(`Workflow not found: ${workflowId}`);
    this.name = 'WorkflowNotFoundError';
  }
}

/**
 * Error thrown when attempting to register a duplicate workflow.
 */
export class DuplicateWorkflowError extends Error {
  constructor(public readonly workflowId: string) {
    super(`Workflow already registered: ${workflowId}`);
    this.name = 'DuplicateWorkflowError';
  }
}

/**
 * Workflow registry interface.
 */
export interface WorkflowRegistry {
  /**
   * Register a workflow. If a workflow with the same ID is already
   * registered, it is silently replaced.
   */
  register(workflow: Workflow): void;

  /**
   * Get a workflow by ID.
   * @throws WorkflowNotFoundError if workflow is not found
   */
  get(workflowId: string): Workflow;

  /**
   * Check if a workflow is registered.
   */
  has(workflowId: string): boolean;

  /**
   * Get all registered workflows.
   */
  getAll(): Workflow[];

  /**
   * Get all workflow IDs.
   */
  getIds(): string[];

  /**
   * Remove a workflow from the registry.
   */
  remove(workflowId: string): boolean;

  /**
   * Clear all workflows from the registry.
   */
  clear(): void;
}

/**
 * Create a workflow registry.
 */
export function createWorkflowRegistry(): WorkflowRegistry {
  const workflows = new Map<string, Workflow>();

  return {
    register(workflow: Workflow): void {
      workflows.set(workflow.id, workflow);
    },

    get(workflowId: string): Workflow {
      const workflow = workflows.get(workflowId);
      if (!workflow) {
        throw new WorkflowNotFoundError(workflowId);
      }
      return workflow;
    },

    has(workflowId: string): boolean {
      return workflows.has(workflowId);
    },

    getAll(): Workflow[] {
      return Array.from(workflows.values());
    },

    getIds(): string[] {
      return Array.from(workflows.keys());
    },

    remove(workflowId: string): boolean {
      return workflows.delete(workflowId);
    },

    clear(): void {
      workflows.clear();
    },
  };
}

/**
 * Global workflow registry instance.
 * Uses globalThis so that ESM and CJS entry points share the same singleton
 * (avoids the dual-package hazard when both dist/index.js and dist/index.cjs
 * are loaded in the same process, e.g. via tsx).
 */
const REGISTRY_KEY = '__polos_global_registry__';
export const globalRegistry: WorkflowRegistry = ((globalThis as Record<string, unknown>)[
  REGISTRY_KEY
] ??= createWorkflowRegistry()) as WorkflowRegistry;
