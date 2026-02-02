import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LeftNavigation } from '@/components/navigation/LeftNavigation';
import { Header } from '@/components/header/Header';
import type { NavigationItem, Project } from '@/types/models';
import { useAuth } from '@/context/AuthContext';
import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { useProject } from '@/context/ProjectContext';

export const ProjectLayout: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { selectedProjectId, setSelectedProjectId } = useProject();
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);

  const fetchUserProjects = useCallback(async () => {
    if (!user) return;

    try {
      setIsLoadingProjects(true);
      const response = await api.getProjects();
      const userProjects = response.projects || [];
      setProjects(userProjects);

      // Validate that the selected project ID exists in the fetched projects
      // If it doesn't exist (e.g., from old localStorage), clear it
      if (selectedProjectId && userProjects.length > 0) {
        const projectExists = userProjects.some(p => p.id === selectedProjectId);
        if (!projectExists) {
          // Old project ID doesn't exist, clear it and use first project
          console.warn(`Project ID ${selectedProjectId} not found in projects, clearing selection`);
          setSelectedProjectId(userProjects[0].id);
        }
      } else if (userProjects.length > 0 && !selectedProjectId) {
        // Set default selected project if we have projects and none is selected
        setSelectedProjectId(userProjects[0].id);
      } else if (userProjects.length === 0) {
        // Clear selected project if there are no projects
        setSelectedProjectId('');
      }
    } catch (error) {
      console.error('Failed to fetch projects:', error);
      setProjects([]);
      setSelectedProjectId('');
    } finally {
      setIsLoadingProjects(false);
    }
  }, [user, selectedProjectId, setSelectedProjectId]);

  // Fetch projects when component mounts or user changes
  useEffect(() => {
    fetchUserProjects();
  }, [fetchUserProjects]);

  if (!user) return null;

  // Get active navigation item from current route
  const getActiveNavItem = () => {
    return location.pathname; // Remove leading slash
  };

  const handleNavItemClick = (item: NavigationItem) => {
    if (item.href) {
      navigate(item.href);
    }
  };

  const handleUpgrade = () => {
    // Navigate to upgrade page or open modal
  };

  const handleLogout = async () => {
    await signOut();
    navigate('/sign-in', { replace: true });
  };

  const handleProfile = () => {
    navigate('/account/settings');
  };

  // Handle project change
  const handleProjectChange = (projectId: string) => {
    setSelectedProjectId(projectId);
  };

  // Handle new project creation
  const handleCreateProject = (projectId: string) => {
    // Refresh the projects list
    fetchUserProjects();
    // Set the newly created project as selected
    setSelectedProjectId(projectId);
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Header - appears on all pages */}
      <Header
        projects={projects.map((project) => ({
          id: project.id,
          name: project.name,
        }))}
        selectedProjectId={selectedProjectId}
        onProjectChange={handleProjectChange}
        isLoadingProjects={isLoadingProjects}
        onCreateProject={handleCreateProject}
      />

      {/* Main content area */}
      <div className="flex h-[calc(100vh-73px)]">
        {/* Left Navigation */}
        <LeftNavigation
          activeItem={getActiveNavItem()}
          onItemClick={handleNavItemClick}
          user={{
            id: user.id,
            first_name: user.first_name ?? '',
            last_name: user.last_name ?? '',
            display_name: user.display_name ?? '',
            email: user.email,
            created_at: String(user.created_at ?? ''),
            updated_at: String(user.updated_at ?? ''),
          }}
          onUpgrade={handleUpgrade}
          onLogout={handleLogout}
          onProfile={handleProfile}
        />

        {/* Page content - this is where individual pages render */}
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
