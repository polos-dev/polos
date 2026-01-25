import React, { useMemo, useCallback } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  Position,
  type Node,
  type Edge,
} from 'reactflow';
import 'reactflow/dist/style.css';
import dagre from 'dagre';
import { cn } from '@/lib/utils';
import type { Span } from '@/types/models';
import { Bot, Network, Wrench, Database } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface TraceGraphViewProps {
  spans: Span[];
  selectedSpanId: string | null;
  onSpanSelect: (spanId: string) => void;
  hasError: (span: Span) => boolean;
  formatDuration: (start: string, end: string) => string;
  formatTime: (isoString: string) => string;
}

const NODE_WIDTH = 220;
const NODE_HEIGHT = 120;

const spanTypeIcon = (spanType: string) => {
  if (spanType === 'agent') {
    return <Bot className="h-4 w-4 text-gray-700" />;
  } else if (spanType === 'workflow') {
    return <Network className="h-4 w-4 text-gray-700" />;
  } else if (spanType === 'tool') {
    return <Wrench className="h-4 w-4 text-gray-700" />;
  }
  return <Database className="h-4 w-4 text-gray-700" />;
};

export const TraceGraphView: React.FC<TraceGraphViewProps> = ({
  spans,
  selectedSpanId,
  onSpanSelect,
  hasError,
  formatDuration,
  formatTime,
}) => {
  // Build span maps
  const spanMap = useMemo(() => {
    const map = new Map<string, Span>();
    spans.forEach((span) => {
      map.set(span.span_id, span);
    });
    return map;
  }, [spans]);

  // Convert spans to ReactFlow nodes and edges
  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: 'TB', nodesep: 50, ranksep: 100 });

    // Create nodes (positions will be set by dagre)
    const nodes: Array<Node & { position?: { x: number; y: number } }> =
      spans.map((span) => {
        const isError = hasError(span);
        const isSelected = selectedSpanId === span.span_id;

        return {
          id: span.span_id,
          type: 'default',
          position: { x: 0, y: 0 }, // Will be overridden by dagre
          data: {
            label: (
              <div
                className={cn(
                  'p-3 rounded-lg border min-w-[220px] cursor-pointer transition-all shadow-sm',
                  isSelected
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 bg-white hover:border-gray-300',
                  isError && 'border-red-500'
                )}
              >
                <div className="flex items-start mb-2">
                  <div
                    className={cn(
                      'p-1.5 rounded flex-shrink-0 mr-2',
                      isError ? 'bg-red-100' : 'bg-blue-100'
                    )}
                  >
                    {spanTypeIcon(span.span_type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate mb-1">
                      {span.name}
                    </div>
                    {isError && (
                      <Badge
                        variant="destructive"
                        className="text-[10px] h-4 px-1.5 mb-1"
                      >
                        Error
                      </Badge>
                    )}
                    <div className="text-xs text-gray-500 mb-1">
                      {span.span_type}
                    </div>
                    <div className="text-xs text-gray-600">
                      {formatTime(span.started_at)}
                    </div>
                    <div className="text-xs text-gray-600 mt-0.5">
                      {formatDuration(
                        span.started_at,
                        span.ended_at || span.started_at
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ),
          },
          style: {
            width: NODE_WIDTH,
            height: NODE_HEIGHT,
            border: 'none',
            background: 'transparent',
          },
        };
      });

    // Create edges
    const edges: Edge[] = [];
    spans.forEach((span) => {
      if (span.parent_span_id && spanMap.has(span.parent_span_id)) {
        edges.push({
          id: `${span.parent_span_id}-${span.span_id}`,
          source: span.parent_span_id,
          target: span.span_id,
          type: 'smoothstep',
          animated: false,
          style: {
            stroke: hasError(span) ? '#ef4444' : '#3b82f6',
            strokeWidth: 2,
          },
        });
      }
    });

    // Add nodes to dagre graph
    nodes.forEach((node) => {
      g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
    });

    // Add edges to dagre graph
    edges.forEach((edge) => {
      g.setEdge(edge.source, edge.target);
    });

    // Layout calculation
    dagre.layout(g);

    // Update node positions
    const layoutedNodes = nodes.map((node) => {
      const nodeWithPosition = g.node(node.id);
      return {
        ...node,
        position: {
          x: nodeWithPosition.x - NODE_WIDTH / 2,
          y: nodeWithPosition.y - NODE_HEIGHT / 2,
        },
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
      };
    });

    return { nodes: layoutedNodes, edges };
  }, [spans, selectedSpanId, hasError, formatDuration, spanMap]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Update nodes when initialNodes change
  React.useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      onSpanSelect(node.id);
    },
    [onSpanSelect]
  );

  return (
    <div className="w-full h-full">
      <style>{`
        .react-flow__node {
          border: none !important;
          background: transparent !important;
        }
        .react-flow__node-default {
          border: none !important;
          background: transparent !important;
          box-shadow: none !important;
        }
      `}</style>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        fitView
        attributionPosition="bottom-left"
      >
        <Background />
        <Controls />
        <MiniMap
          nodeColor={(node) => {
            const span = spanMap.get(node.id);
            if (!span) return '#e5e7eb';
            return hasError(span) ? '#ef4444' : '#3b82f6';
          }}
          maskColor="rgba(0, 0, 0, 0.1)"
        />
      </ReactFlow>
    </div>
  );
};
