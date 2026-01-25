import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from 'react';

const STORAGE_KEY = 'selectedProjectId';

type ProjectContextType = {
  selectedProjectId: string;
  setSelectedProjectId: (projectId: string) => void;
};

const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

export const ProjectProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  // Initialize from localStorage if available
  const [selectedProjectId, setSelectedProjectIdState] = useState<string>(
    () => {
      if (typeof window !== 'undefined') {
        return localStorage.getItem(STORAGE_KEY) || '';
      }
      return '';
    }
  );

  // Sync to localStorage whenever selectedProjectId changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (selectedProjectId) {
        localStorage.setItem(STORAGE_KEY, selectedProjectId);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
  }, [selectedProjectId]);

  // Wrapper function to update both state and localStorage
  const setSelectedProjectId = (projectId: string) => {
    setSelectedProjectIdState(projectId);
  };

  return (
    <ProjectContext.Provider
      value={{
        selectedProjectId,
        setSelectedProjectId,
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
};

export const useProject = () => {
  const context = useContext(ProjectContext);
  if (context === undefined) {
    throw new Error('useProject must be used within a ProjectProvider');
  }
  return context;
};
