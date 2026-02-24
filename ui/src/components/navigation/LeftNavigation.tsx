import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { NavigationItem, User } from '../../types/models';
import {
  Bot,
  Settings,
  Network,
  FileSearch,
  LogOut,
  MessagesSquare,
  Wrench,
  BookOpen,
  Github,
  MessageCircle,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { useLocation } from 'react-router-dom';

interface LeftNavigationProps {
  onToggle?: () => void;
  activeItem?: string;
  onItemClick?: (item: NavigationItem) => void;
  className?: string;
  user: User;
  onUpgrade?: () => void;
  onLogout?: () => void;
  onProfile?: () => void;
}

const getFirstNameInitial = (name: string) => {
  return name.length > 0 ? name.charAt(0).toLocaleUpperCase() : 'U';
};

interface UserProfileProps {
  user: User;
  onLogout?: () => void;
  onProfile?: () => void;
}

const UserProfileItem: React.FC<UserProfileProps> = ({
  user,
  onLogout,
  onProfile,
}) => {
  const handleLogout = async () => {
    if (onLogout) {
      onLogout();
    }
  };

  const handleProfile = () => {
    if (onProfile) {
      onProfile();
    }
  };

  return (
    <div className="p-2 border-t border-gray-200">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className={cn(
              'w-full h-auto py-2 font-normal hover:bg-gray-50 hover:text-gray-900 justify-start',
              'space-x-1'
            )}
          >
            <Avatar className="shrink-0 h-6 w-6">
              <AvatarImage src={user.avatar} alt={user.display_name} />
              <AvatarFallback className="bg-brand-primary text-white font-medium">
                {getFirstNameInitial(user.display_name)}
              </AvatarFallback>
            </Avatar>

            <div className="flex flex-col items-start text-left min-w-0">
              <span className="text-sm font-medium truncate w-full">
                {user.display_name}
              </span>
              <span className="text-xs text-gray-500 truncate w-full">
                {user.email}
              </span>
            </div>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56" align="end" side="right">
          <DropdownMenuLabel>
            <div className="flex flex-col space-y-1">
              <p className="text-sm font-medium">{user.display_name}</p>
              <p className="text-xs text-gray-500">{user.email}</p>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleProfile} className="cursor-pointer">
            <Settings className="mr-2 h-4 w-4" />
            <span>Settings</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={handleLogout}
            className="cursor-pointer text-red-600 focus:text-red-600"
          >
            <LogOut className="mr-2 h-4 w-4" />
            <span>Log out</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

export const LeftNavigation: React.FC<LeftNavigationProps> = ({
  onItemClick,
  className,
  user,
  onLogout,
  onProfile,
}) => {
  // Define flat navigation items
  const runnableItems: NavigationItem[] = [
    { id: 'agents', label: 'Agents', icon: Bot, href: '/agents' },
    { id: 'workflows', label: 'Workflows', icon: Network, href: '/workflows' },
    { id: 'tools', label: 'Tools', icon: Wrench, href: '/tools' },
  ];

  const observableItems: NavigationItem[] = [
    {
      id: 'sessions',
      label: 'Sessions',
      icon: MessagesSquare,
      href: '/sessions',
    },
    { id: 'traces', label: 'Traces', icon: FileSearch, href: '/traces' },
  ];

  const NavItem: React.FC<{ item: NavigationItem }> = ({ item }) => {
    const Icon = item.icon;
    const location = useLocation();
    const isActive = item.href && location.pathname.startsWith(item.href);

    const button = (
      <Button
        variant="ghost"
        onClick={() => onItemClick?.(item)}
        className={cn(
          'w-full justify-start h-10 font-medium transition-all duration-200 cursor-pointer text-sm text-gray-600',
          'hover:bg-gray-50 hover:text-gray-900',
          'px-3',
          isActive && [
            'bg-gray-200 text-black hover:bg-gray-300 hover:text-black',
          ]
        )}
      >
        <Icon className="h-5 w-5 shrink-0 mr-3" />

        <>
          <span className="truncate">{item.label}</span>
          {item.badge && (
            <Badge
              variant={isActive ? 'secondary' : 'outline'}
              className={cn(
                'ml-auto h-5 text-sm',
                isActive
                  ? 'bg-gray-700 text-white border-gray-600'
                  : 'border-gray-200'
              )}
            >
              {item.badge}
            </Badge>
          )}
        </>
      </Button>
    );

    return button;
  };

  return (
    <div
      className={cn(
        'flex flex-col bg-white border-r border-gray-200 transition-all duration-300 ease-in-out relative',
        'w-48',
        className
      )}
    >
      {/* Main Navigation */}
      <div className="flex-1 p-1 space-y-1 overflow-y-auto">
        <div className="space-y-1 mt-3">
          {runnableItems.map((item) => (
            <NavItem key={item.id} item={item} />
          ))}
        </div>

        {/* Horizontal separator */}
        <div className="my-2 border-t border-gray-200"></div>

        <div className="space-y-1">
          {observableItems.map((item) => (
            <NavItem key={item.id} item={item} />
          ))}
        </div>
      </div>

      {/* External Links */}
      <div className="p-1 space-y-1 border-t border-gray-200">
        <Button
          variant="ghost"
          className={cn(
            'w-full justify-start h-10 font-medium transition-all duration-200 cursor-pointer text-sm text-gray-600',
            'hover:bg-gray-50 hover:text-gray-900',
            'px-3'
          )}
          onClick={() => window.open('https://docs.polos.dev', '_blank')}
        >
          <BookOpen className="h-5 w-5 shrink-0 mr-3" />
          <span className="truncate">Documentation</span>
        </Button>
        <Button
          variant="ghost"
          className={cn(
            'w-full justify-start h-10 font-medium transition-all duration-200 cursor-pointer text-sm text-gray-600',
            'hover:bg-gray-50 hover:text-gray-900',
            'px-3'
          )}
          onClick={() =>
            window.open('https://github.com/polos-dev/polos', '_blank')
          }
        >
          <Github className="h-5 w-5 shrink-0 mr-3" />
          <span className="truncate">GitHub</span>
        </Button>
        <Button
          variant="ghost"
          className={cn(
            'w-full justify-start h-10 font-medium transition-all duration-200 cursor-pointer text-sm text-gray-600',
            'hover:bg-gray-50 hover:text-gray-900',
            'px-3'
          )}
          onClick={() => window.open('https://discord.gg/ZAxHKMPwFG', '_blank')}
        >
          <MessageCircle className="h-5 w-5 shrink-0 mr-3" />
          <span className="truncate">Discord</span>
        </Button>
      </div>

      {/* User Profile */}
      <UserProfileItem user={user} onLogout={onLogout} onProfile={onProfile} />
    </div>
  );
};
