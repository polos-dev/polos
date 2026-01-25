import React, { useState } from 'react';
import { type User } from '../../types/models';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { Skeleton } from '../ui/skeleton';
import { api } from '@/lib/api';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { DialogDescription } from '@radix-ui/react-dialog';
import { Plus, Settings } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface HeaderProps {
  user: User;
  projects: { id: string; name: string }[];
  selectedProjectId: string;
  onProjectChange: (projectId: string) => void;
  isLoadingProjects?: boolean;
  onCreateProject?: (projectId: string) => void;
  onUpgrade?: () => void;
  onLogout?: () => void;
  onProfile?: () => void;
  logoSrc?: string;
  className?: string;
}

export const Header: React.FC<HeaderProps> = ({
  user,
  projects = [],
  selectedProjectId,
  onProjectChange,
  isLoadingProjects = false,
  onCreateProject,
  onUpgrade,
  onLogout,
  onProfile,
  logoSrc = '/polos-logo-horizontal.png',
  className,
}) => {
  const navigate = useNavigate();
  const [isNewProjectDialogOpen, setIsNewProjectDialogOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [projectError, setProjectError] = useState('');
  const [selectOpen, setSelectOpen] = useState(false);
  // Get the current project name for display
  const selectedProjectName =
    projects.find((project) => project.id === selectedProjectId)?.name ||
    'Select Project';

  // Handle new project creation
  const handleCreateProject = async () => {
    if (!newProjectName.trim()) {
      setProjectError('Project name is required');
      return;
    }

    setIsCreatingProject(true);
    setProjectError('');

    try {
      // Call API to create project
      const response = await api.createProject({
        name: newProjectName.trim(),
      });

      setIsNewProjectDialogOpen(false);
      setNewProjectName('');

      // Call the callback to refresh the list and select the new project
      if (onCreateProject) {
        onCreateProject(response.id);
      }
    } catch (error) {
      console.error('Failed to create project:', error);
      setProjectError('Failed to create project. Please try again.');
    } finally {
      setIsCreatingProject(false);
    }
  };

  return (
    <header
      className={cn(
        'flex items-center justify-between px-6 py-1 bg-white border-b border-gray-200',
        className
      )}
    >
      {/* Logo and Project */}
      <div className="flex items-center space-x-4">
        {/* Logo */}
        <div className="flex items-center space-x-3">
          <div className="h-12">
            <img
              src={logoSrc}
              alt="Polos"
              className="block h-12 w-auto object-contain shrink-0"
            />
          </div>
        </div>

        {/* Project Separator */}
        <div className="h-6 w-px bg-gray-300"></div>

        {/* Project Select Dropdown */}
        {isLoadingProjects ? (
          <Skeleton className="h-10 w-[160px]" />
        ) : (
          <Select
            value={selectedProjectId || undefined}
            open={selectOpen}
            onOpenChange={setSelectOpen}
            onValueChange={(value) => {
              if (value === 'new-project') {
                // Close the select dropdown
                setSelectOpen(false);
                // Open dialog but don't change the Select value
                setIsNewProjectDialogOpen(true);
                // Don't call onProjectChange for "new-project"
                return;
              }
              setSelectOpen(false);
              onProjectChange(value);
            }}
          >
            <SelectTrigger className="h-7 px-2 py-4 text-xs leading-none rounded min-w-[160px]">
              <SelectValue placeholder="Select project">
                {selectedProjectId ? selectedProjectName : 'Select Project'}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {projects.map((project) => (
                <SelectItem
                  key={project.id}
                  value={project.id}
                  className="text-xs"
                >
                  {project.name}
                </SelectItem>
              ))}
              <SelectItem
                value="new-project"
                className="text-xs text-blue-600 border-t mt-1 pt-1"
                onPointerDown={(e) => {
                  // Prevent the default select behavior and stop propagation
                  e.preventDefault();
                  // Close the select dropdown
                  setSelectOpen(false);
                  // Open the dialog immediately
                  setIsNewProjectDialogOpen(true);
                }}
              >
                <div className="flex items-center">
                  <Plus className="h-3 w-3 mr-1" />
                  <span>New Project</span>
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Right side - Settings button */}
      <div className="flex items-center">
        <Button
          variant="ghost"
          onClick={() => navigate('/projects/settings')}
          className="h-8 px-3 text-sm"
        >
          <Settings className="h-4 w-4 mr-2" />
          Settings
        </Button>
      </div>

      {/* New Project Dialog */}
      <Dialog
        open={isNewProjectDialogOpen}
        onOpenChange={setIsNewProjectDialogOpen}
      >
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Create New Project</DialogTitle>
            <DialogDescription>
              Enter a name for your new project.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="project-name" className="text-right">
                Name
              </Label>
              <Input
                id="project-name"
                className="col-span-3"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="My Project"
              />
            </div>
            {projectError && (
              <div className="text-red-500 text-sm ml-[calc(25%+16px)]">
                {projectError}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsNewProjectDialogOpen(false)}
              disabled={isCreatingProject}
            >
              Cancel
            </Button>
            <Button onClick={handleCreateProject} disabled={isCreatingProject}>
              {isCreatingProject ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </header>
  );
};
