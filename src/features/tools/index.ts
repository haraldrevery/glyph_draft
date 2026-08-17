import type { ToolId } from "../../state/editorStore";
import type { ToolDefinition } from "./types";
import { selectTool } from "./select";
import { lassoTool } from "./lasso";
import { penTool } from "./pen";
import { freepenTool } from "./freepen";
import { scissorsTool } from "./scissors";
import { knifeTool } from "./knife";
import { eraserTool } from "./eraser";
import {
  rectangleTool,
  ellipseTool,
  lineTool,
  polygonTool,
  triangleTool,
} from "./shapes";

/**
 * The tool registry. Order here is the order shown in the toolbar. Adding a new
 * tool is a one-line change: implement a ToolDefinition, drop it in this array,
 * and it gets a button, a keyboard shortcut, and event routing for free — the
 * controller and toolbar are entirely data-driven from this list.
 */
export const TOOLS: ToolDefinition[] = [
  selectTool,
  lassoTool,
  penTool,
  freepenTool,
  scissorsTool,
  knifeTool,
  eraserTool,
  rectangleTool,
  ellipseTool,
  lineTool,
  polygonTool,
  triangleTool,
];

const BY_ID = new Map<ToolId, ToolDefinition>(TOOLS.map((t) => [t.id, t]));

export function getTool(id: ToolId): ToolDefinition {
  return BY_ID.get(id) ?? selectTool;
}

export type { ToolDefinition } from "./types";
