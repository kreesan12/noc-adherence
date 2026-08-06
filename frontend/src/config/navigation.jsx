import { Badge } from '@mui/material'
import HomeRoundedIcon from '@mui/icons-material/HomeRounded'
import DashboardRoundedIcon from '@mui/icons-material/DashboardRounded'
import CalendarMonthRoundedIcon from '@mui/icons-material/CalendarMonthRounded'
import AdminPanelSettingsRoundedIcon from '@mui/icons-material/AdminPanelSettingsRounded'
import QueryStatsRoundedIcon from '@mui/icons-material/QueryStatsRounded'
import UploadFileRoundedIcon from '@mui/icons-material/UploadFileRounded'
import ManageAccountsRoundedIcon from '@mui/icons-material/ManageAccountsRounded'
import EventBusyRoundedIcon from '@mui/icons-material/EventBusyRounded'
import PeopleRoundedIcon from '@mui/icons-material/PeopleRounded'
import LanRoundedIcon from '@mui/icons-material/LanRounded'
import MapRoundedIcon from '@mui/icons-material/MapRounded'
import AvTimerRoundedIcon from '@mui/icons-material/AvTimerRounded'
import InsightsRoundedIcon from '@mui/icons-material/InsightsRounded'
import Inventory2RoundedIcon from '@mui/icons-material/Inventory2Rounded'
import GroupWorkRoundedIcon from '@mui/icons-material/GroupWorkRounded'
import SettingsSuggestRoundedIcon from '@mui/icons-material/SettingsSuggestRounded'
import ChatRoundedIcon from '@mui/icons-material/ChatRounded'
import { canManageUsers } from '../utils/access'

export function isActivePath(pathname, itemPath) {
  if (itemPath === '/') return pathname === '/'
  return pathname === itemPath || pathname.startsWith(`${itemPath}/`)
}

export function sectionHasActive(pathname, section) {
  return section.items.some((item) => isActivePath(pathname, item.path))
}

export function flattenNavigationItems(sections) {
  return sections.flatMap((section) => section.items.map((item) => ({ ...item, section: section.title })))
}

export function buildNavigationSections(user, vacancyCount = 0) {
  return [
    {
      title: 'WORKSPACE',
      icon: <HomeRoundedIcon fontSize="small" />,
      items: [
        {
          label: 'Overview',
          path: '/',
          summary: 'Jump to the main workspace launcher and quick navigation view.',
          icon: <HomeRoundedIcon fontSize="small" />
        }
      ]
    },
    {
      title: 'DAILY OPERATIONS',
      icon: <DashboardRoundedIcon fontSize="small" />,
      items: [
        {
          label: 'Adherence Tracking',
          path: '/adherence',
          summary: 'Monitor daily adherence performance and operational movement.',
          icon: <DashboardRoundedIcon fontSize="small" />
        },
        {
          label: 'Weekly Schedule',
          path: '/schedule',
          summary: 'Review the current schedule and weekly planning view.',
          icon: <CalendarMonthRoundedIcon fontSize="small" />
        },
        {
          label: 'Leave Planner',
          path: '/leave-planner',
          summary: 'Track leave windows and planning conflicts.',
          icon: <EventBusyRoundedIcon fontSize="small" />
        }
      ]
    },
    {
      title: 'STAFFING AND SCHEDULING',
      icon: <GroupWorkRoundedIcon fontSize="small" />,
      items: [
        {
          label: 'Volumes and Forecasting',
          path: '/volume',
          summary: 'Compare incoming demand and planning forecasts.',
          icon: <QueryStatsRoundedIcon fontSize="small" />
        },
        {
          label: 'Staffing and Scheduling',
          path: '/staffing',
          summary: 'Review staffing patterns, heatmaps, and scheduling balance.',
          icon: <ManageAccountsRoundedIcon fontSize="small" />
        },
        {
          label: 'Shift Manager',
          path: '/shifts',
          summary: 'Edit shifts, swap ranges, and handle reassignment windows.',
          icon: <ManageAccountsRoundedIcon fontSize="small" />
        }
      ]
    },
    {
      title: 'SETTINGS',
      icon: <SettingsSuggestRoundedIcon fontSize="small" />,
      items: [
        ...(canManageUsers(user?.role)
          ? [{
              label: 'User Admin',
              path: '/settings/users',
              summary: 'Create, reset, and govern sign-in access across the platform.',
              icon: <ManageAccountsRoundedIcon fontSize="small" />
            }, {
              label: 'WhatsApp Watchers',
              path: '/settings/whatsapp-watchers',
              summary: 'Control alert timing, routing groups, tags, and watcher wording.',
              icon: <ChatRoundedIcon fontSize="small" />
            }]
          : []),
        {
          label: 'Workforce',
          path: '/workforce',
          summary: 'Track workforce requests, vacancies, and staffing approvals.',
          icon: (
            <Badge badgeContent={vacancyCount} color="secondary">
              <PeopleRoundedIcon fontSize="small" />
            </Badge>
          )
        },
        {
          label: 'Admin',
          path: '/agents',
          summary: 'Maintain base admin records and application lists.',
          icon: <AdminPanelSettingsRoundedIcon fontSize="small" />
        },
        {
          label: 'Upload Roster',
          path: '/roster',
          summary: 'Load new roster data into the platform.',
          icon: <UploadFileRoundedIcon fontSize="small" />
        },
        {
          label: 'Overtime Capturing',
          path: '/overtime/capture',
          summary: 'Capture overtime records for the current period.',
          icon: <LanRoundedIcon fontSize="small" />
        },
        {
          label: 'Overtime Supervisor',
          path: '/overtime/supervisor',
          summary: 'Supervisor review and approval for overtime entries.',
          icon: <LanRoundedIcon fontSize="small" />
        },
        {
          label: 'Overtime Manager',
          path: '/overtime/manager',
          summary: 'Manager approval lane for overtime processing.',
          icon: <LanRoundedIcon fontSize="small" />
        },
        {
          label: 'Signatures',
          path: '/settings/signature',
          summary: 'Maintain signature assets used in approvals and forms.',
          icon: <LanRoundedIcon fontSize="small" />
        }
      ]
    },
    {
      title: 'ENGINEERING',
      icon: <LanRoundedIcon fontSize="small" />,
      items: [
        {
          label: 'NLD Light Levels',
          path: '/engineering/nlds',
          summary: 'Review live and historical NLD light levels and drift.',
          icon: <LanRoundedIcon fontSize="small" />
        },
        {
          label: 'NLD Uptime',
          path: '/nld-uptime',
          summary: 'See monthly uptime rollups per circuit and NLD group.',
          icon: <AvTimerRoundedIcon fontSize="small" />
        },
        {
          label: 'NLD Mapping',
          path: '/nld-mapping',
          summary: 'Organize circuits into NLD groups and mapping lanes.',
          icon: <MapRoundedIcon fontSize="small" />
        },
        {
          label: 'NLD Map',
          path: '/nld-map',
          summary: 'Explore geographic span relationships visually.',
          icon: <MapRoundedIcon fontSize="small" />
        },
        {
          label: 'NLD Admin',
          path: '/nld-admin',
          summary: 'Maintain circuit master data and mapping details.',
          icon: <AdminPanelSettingsRoundedIcon fontSize="small" />
        },
        {
          label: 'NLD Services',
          path: '/engineering/nld-services',
          summary: 'Review blank RX issues, ticket staging, and service actions.',
          icon: <AdminPanelSettingsRoundedIcon fontSize="small" />
        }
      ]
    },
    {
      title: 'SLA REPORTING',
      icon: <InsightsRoundedIcon fontSize="small" />,
      items: [
        {
          label: 'ISP SLA Dashboard',
          path: '/sla-reporting',
          summary: 'Track SLA outcomes, breaches, tickets, and outage patterns.',
          icon: <InsightsRoundedIcon fontSize="small" />
        }
      ]
    },
    {
      title: 'STOCK MANAGEMENT',
      icon: <Inventory2RoundedIcon fontSize="small" />,
      items: [
        {
          label: 'Stock Master',
          path: '/stock-management',
          summary: 'Review stock coverage, run rates, and warehouse gaps.',
          icon: <Inventory2RoundedIcon fontSize="small" />
        }
      ]
    }
  ]
}
