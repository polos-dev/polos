import { Routes, Route, Navigate } from 'react-router-dom';
import { ProjectLayout } from '@/layouts/ProjectLayout';
import { AgentsPage } from '@/pages/agents/Agent';
import { WorkflowsPage } from '@/pages/workflows/Workflow';
import { ToolsPage } from '@/pages/tools/Tool';
import { ToolRunPage } from '@/pages/tools/ToolRun';
import { ToolTraceListPage } from '@/pages/tools/ToolTraceList';
import { WorkflowRunPage } from '@/pages/workflows/WorkflowRun';
import { WorkflowTraceListPage } from '@/pages/workflows/WorkflowTraceList';
import { AgentRunPage } from '@/pages/agents/AgentRun';
import { AgentTraceListPage } from '@/pages/agents/AgentTraceList';
import { AccountSettingsPage } from '@/pages/account/Settings';
import { ProjectSettingsPage } from '@/pages/projects/Settings';
import { TraceDetailPage } from '@/pages/traces/TraceDetail';
import { TraceListPage } from '@/pages/traces/TraceList';
import SignIn from './pages/auth/SignIn';
import SignUp from './pages/auth/SignUp';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import { isLocalMode } from '@/lib/localMode';

function App() {
  const localMode = isLocalMode();

  return (
    <Routes>
      {/* Default root → /agents in local mode, /sign-in otherwise */}
      <Route
        path="/"
        element={<Navigate to={localMode ? '/agents' : '/sign-in'} replace />}
      />

      {/* Public auth routes */}
      <Route path="/sign-in" element={<SignIn />} />
      <Route path="/sign-up" element={<SignUp />} />

      {/* Protected app routes */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <ProjectLayout />
          </ProtectedRoute>
        }
      >
        <Route path="agents" element={<AgentsPage />} />
        <Route path="agents/:agentId/run" element={<AgentRunPage />} />
        <Route path="agents/:agentId/traces" element={<AgentTraceListPage />} />
        <Route path="workflows" element={<WorkflowsPage />} />
        <Route path="workflows/:workflowId/run" element={<WorkflowRunPage />} />
        <Route
          path="workflows/:workflowId/traces"
          element={<WorkflowTraceListPage />}
        />
        <Route path="tools" element={<ToolsPage />} />
        <Route path="tools/:toolId/run" element={<ToolRunPage />} />
        <Route path="tools/:toolId/traces" element={<ToolTraceListPage />} />
        <Route path="traces" element={<TraceListPage />} />
        <Route path="traces/:traceId" element={<TraceDetailPage />} />
        <Route path="account/settings" element={<AccountSettingsPage />} />
        <Route path="projects/settings" element={<ProjectSettingsPage />} />
      </Route>
    </Routes>
  );
}

export default App;
