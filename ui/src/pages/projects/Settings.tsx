import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Copy, PlusIcon, SearchIcon, Trash2, Key, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { type Project, ProjectRole } from '@/types/models';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { useProject } from '@/context/ProjectContext';
import { toast } from 'sonner';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { DialogDescription } from '@radix-ui/react-dialog';

type Member = {
  id: string;
  user: {
    id: string;
    email: string;
    first_name?: string;
    last_name?: string;
    display_name?: string;
  };
  role: ProjectRole;
  created_at: string;
};

type ApiKey = {
  id: string;
  name: string;
  last_four_digits: string;
  last_used_at?: string;
  created_at: string;
  expires_at?: string;
};

export const ProjectSettingsPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const { user } = useAuth();
  const { selectedProjectId } = useProject();

  const [project, setProject] = useState<Project | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<string>('api-keys');

  // API Keys state
  const [isCreateKeyDialogOpen, setIsCreateKeyDialogOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [isCreatingKey, setIsCreatingKey] = useState(false);
  const [keyError, setKeyError] = useState('');
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<{
    key: string;
    name: string;
  } | null>(null);
  const [isCopyingNewKey, setIsCopyingNewKey] = useState(false);

  // Member state
  const [searchMemberTerm, setSearchMemberTerm] = useState('');

  useEffect(() => {
    const fetchProjectData = async () => {
      if (!selectedProjectId) return;

      setIsLoading(true);

      try {
        // Fetch project details
        const projectResponse = await api.getProject(selectedProjectId);
        setProject(projectResponse);

        // Fetch members
        const membersResponse = await api.getProjectMembers(selectedProjectId);
        const formattedMembers = membersResponse.map((m: any) => ({
          id: m.id,
          user: {
            id: m.user_id,
            email: m.user?.email || '',
            first_name: m.user?.first_name,
            last_name: m.user?.last_name,
            display_name: m.user?.display_name,
          },
          role: m.role,
          created_at: m.created_at || m.created_at,
        }));
        setMembers(formattedMembers);

        // Fetch API keys
        const keysResponse = await api.getProjectApiKeys(selectedProjectId);
        const formattedKeys = keysResponse.map((k: any) => ({
          id: k.id,
          name: k.name,
          last_four_digits: k.last_four_digits || '****',
          last_used_at: k.last_used_at,
          created_at: k.created_at,
          expires_at: k.expires_at,
        }));
        setApiKeys(formattedKeys);
      } catch (error) {
        console.error('Failed to fetch project data:', error);
        toast.error('Failed to load project settings');
      } finally {
        setIsLoading(false);
      }
    };

    fetchProjectData();
  }, [selectedProjectId, user]);

  const filteredMembers = members.filter(
    (member) =>
      member.user.email
        .toLowerCase()
        .includes(searchMemberTerm.toLowerCase()) ||
      (member.user.display_name &&
        member.user.display_name
          .toLowerCase()
          .includes(searchMemberTerm.toLowerCase()))
  );

  // API Key management
  const handleCreateApiKey = async () => {
    if (!newKeyName.trim()) {
      setKeyError('Key name is required');
      return;
    }

    setIsCreatingKey(true);
    setKeyError('');

    try {
      const response = await api.createProjectApiKey({
        projectId: selectedProjectId || '',
        name: newKeyName.trim(),
      });

      // Store the newly created key to display it
      setNewlyCreatedKey({
        key: response.key,
        name: response.name,
      });

      // Add the new key to the list (without the full key)
      const formattedKey = {
        id: response.id,
        name: response.name,
        last_four_digits:
          response.last_four_digits || response.key?.slice(-4) || '****',
        last_used_at: response.last_used_at,
        created_at: response.created_at,
        expires_at: response.expires_at,
      };
      setApiKeys([...apiKeys, formattedKey]);

      // Reset form but keep dialog open to show the key
      setNewKeyName('');
      toast.success('API key created successfully');
    } catch (error) {
      console.error('Failed to create API key:', error);
      setKeyError('Failed to create API key. Please try again.');
      toast.error('Failed to create API key');
    } finally {
      setIsCreatingKey(false);
    }
  };

  const handleCopyNewKey = async () => {
    if (!newlyCreatedKey) return;

    try {
      setIsCopyingNewKey(true);
      await navigator.clipboard.writeText(newlyCreatedKey.key);
      toast.success('API key copied to clipboard');
    } catch (error) {
      console.error('Failed to copy API key:', error);
      toast.error('Failed to copy API key');
    } finally {
      setIsCopyingNewKey(false);
    }
  };

  const handleCloseCreateKeyDialog = () => {
    setIsCreateKeyDialogOpen(false);
    setNewKeyName('');
    setKeyError('');
    setNewlyCreatedKey(null);
  };

  const handleDeleteKey = async (keyId: string) => {
    try {
      await api.deleteProjectApiKey({
        projectId: projectId || '',
        keyId,
      });

      setApiKeys(apiKeys.filter((key) => key.id !== keyId));
      toast.success('API key deleted successfully');
    } catch (error) {
      console.error('Failed to delete API key:', error);
      toast.error('Failed to delete API key');
    }
  };

  const getRoleBadge = (role: ProjectRole) => {
    switch (role) {
      case ProjectRole.ADMIN:
        return (
          <Badge className="bg-purple-100 text-purple-800 border-purple-300">
            Admin
          </Badge>
        );
      case ProjectRole.MEMBER:
        return (
          <Badge className="bg-blue-100 text-blue-800 border-blue-300">
            Member
          </Badge>
        );
      case ProjectRole.VIEWER:
        return (
          <Badge className="bg-gray-100 text-gray-800 border-gray-300">
            Viewer
          </Badge>
        );
      default:
        return (
          <Badge className="bg-gray-100 text-gray-800 border-gray-300">
            {role}
          </Badge>
        );
    }
  };

  // Navigation sections
  const sections = [
    { id: 'api-keys', label: 'API Keys', icon: <Key className="h-4 w-4" /> },
    { id: 'members', label: 'Members', icon: <Users className="h-4 w-4" /> },
  ];

  // Render section content based on active section
  const renderSectionContent = () => {
    switch (activeSection) {
      case 'api-keys':
        return renderApiKeysSection();
      case 'members':
        return renderMembersSection();
      default:
        return renderApiKeysSection();
    }
  };

  // API Keys section
  const renderApiKeysSection = () => {
    return (
      <div className="space-y-4">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 mb-4">
          <div>
            <h2 className="text-lg font-medium">API Keys</h2>
            <p className="text-xs text-gray-500">
              Manage API keys for accessing your project resources
            </p>
          </div>

          <Button onClick={() => setIsCreateKeyDialogOpen(true)}>
            <PlusIcon className="h-4 w-4 mr-2" /> New API Key
          </Button>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : apiKeys.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg border">
            <Key className="h-12 w-12 mx-auto mb-4 text-gray-400" />
            <h3 className="text-medium font-medium text-gray-900 mb-2">
              No API Keys
            </h3>
            <p className="text-sm text-gray-500 mb-6">
              Create your first API key to access the API programmatically.
            </p>
            <Button onClick={() => setIsCreateKeyDialogOpen(true)}>
              <PlusIcon className="h-4 w-4 mr-2" /> Create API Key
            </Button>
          </div>
        ) : (
          <div className="bg-white rounded-md border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Last Used</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {apiKeys.map((key) => (
                  <TableRow key={key.id}>
                    <TableCell className="font-medium">{key.name}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Input
                          type="text"
                          value={`••••••••••••••••${key.last_four_digits}`}
                          className="h-8 font-mono"
                          readOnly
                        />
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">
                      {new Date(key.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-xs">
                      {key.last_used_at
                        ? new Date(key.last_used_at).toLocaleString()
                        : 'Never'}
                    </TableCell>
                    <TableCell className="text-right">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 text-red-600 hover:text-red-800 hover:bg-red-50"
                              onClick={() => handleDeleteKey(key.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Delete Key</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    );
  };

  // Members section
  const renderMembersSection = () => {
    return (
      <div className="space-y-4">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 mb-4">
          <div>
            <h2 className="text-lg font-medium">Members</h2>
            <p className="text-xs text-gray-500">
              Manage members and their roles within your project
            </p>
          </div>

          <div className="flex gap-2 w-full lg:w-auto">
            <div className="relative w-full sm:w-64">
              <SearchIcon className="absolute left-2 top-2 h-4 w-4 text-gray-500" />
              <Input
                placeholder="Search members"
                className="pl-8 text-xs h-8"
                value={searchMemberTerm}
                onChange={(e) => setSearchMemberTerm(e.target.value)}
              />
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : filteredMembers.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg border">
            <Users className="h-12 w-12 mx-auto mb-4 text-gray-400" />
            <h3 className="text-medium font-medium text-gray-900 mb-2">
              No Members Found
            </h3>
            {searchMemberTerm ? (
              <p className="text-sm text-gray-500 mb-6">
                No members match your search criteria
              </p>
            ) : (
              <p className="text-sm text-gray-500 mb-6">
                No members found in this project
              </p>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-md border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Joined</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredMembers.map((member) => (
                  <TableRow key={member.id}>
                    <TableCell className="font-medium">
                      {member.user.display_name ||
                        member.user.first_name ||
                        'Unknown User'}
                    </TableCell>
                    <TableCell>{member.user.email}</TableCell>
                    <TableCell>{getRoleBadge(member.role)}</TableCell>
                    <TableCell className="text-xs">
                      {new Date(member.created_at).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto">
        {/* Project Header */}
        <div className="bg-white rounded-lg border-b border-gray-200 p-6">
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-64" />
              <Skeleton className="h-4 w-32" />
            </div>
          ) : (
            <div className="flex justify-between items-start">
              <div>
                <h1 className="text-2xl font-medium text-gray-900">
                  {project?.name}
                </h1>
                <p className="text-xs font-mono text-gray-500 mt-1">
                  ID: {project?.id}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Settings Content with Left Panel */}
        <div className="flex h-[calc(100vh-12rem)] overflow-hidden">
          {/* Left Panel Navigation */}
          <div className="w-64 border-r border-gray-200 bg-white p-4">
            <nav className="space-y-1">
              {sections.map((section) => (
                <Button
                  key={section.id}
                  variant="ghost"
                  className={cn(
                    'w-full justify-start py-2 px-3 text-sm',
                    activeSection === section.id
                      ? 'bg-gray-100 text-gray-900 font-medium'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  )}
                  onClick={() => setActiveSection(section.id)}
                >
                  <div className="flex items-center">
                    {section.icon}
                    <span className="ml-3">{section.label}</span>
                  </div>
                </Button>
              ))}
            </nav>
          </div>

          {/* Main Content Area */}
          <div className="flex-1 overflow-auto p-6 bg-gray-50">
            {renderSectionContent()}
          </div>
        </div>

        {/* Create API Key Dialog */}
        <Dialog
          open={isCreateKeyDialogOpen}
          onOpenChange={handleCloseCreateKeyDialog}
        >
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>
                {newlyCreatedKey ? 'API Key Created' : 'Create API Key'}
              </DialogTitle>
              <DialogDescription>
                {newlyCreatedKey
                  ? "Your API key has been created. Please copy it now as you won't be able to see it again."
                  : 'Create a new API key for programmatic access to this project.'}
              </DialogDescription>
            </DialogHeader>
            {newlyCreatedKey ? (
              <div className="grid gap-4 py-4">
                <div className="space-y-2">
                  <Label>API Key</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="text"
                      value={newlyCreatedKey.key}
                      className="font-mono text-sm"
                      readOnly
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleCopyNewKey}
                      disabled={isCopyingNewKey}
                    >
                      {isCopyingNewKey ? (
                        <span className="h-4 w-4 animate-spin">⟳</span>
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
                <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3">
                  <p className="text-sm text-yellow-800">
                    <strong>Important:</strong> Store this API key in a safe
                    place. You won't be able to view it again after closing this
                    dialog.
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="key-name" className="text-right">
                    Key Name
                  </Label>
                  <Input
                    id="key-name"
                    className="col-span-3"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    placeholder="e.g. Development, Production"
                  />
                </div>
                {keyError && (
                  <div className="text-red-500 text-sm ml-[calc(25%+16px)]">
                    {keyError}
                  </div>
                )}
              </div>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                onClick={handleCloseCreateKeyDialog}
                disabled={isCreatingKey}
              >
                {newlyCreatedKey ? 'Done' : 'Cancel'}
              </Button>
              {!newlyCreatedKey && (
                <Button onClick={handleCreateApiKey} disabled={isCreatingKey}>
                  {isCreatingKey ? 'Creating...' : 'Create Key'}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};

export default ProjectSettingsPage;
