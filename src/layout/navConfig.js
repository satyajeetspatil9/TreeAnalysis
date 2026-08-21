import ParkIcon from '@mui/icons-material/Park';
import WaterDropIcon from '@mui/icons-material/WaterDrop';
import ScienceIcon from '@mui/icons-material/Science';
import MonitorHeartIcon from '@mui/icons-material/MonitorHeart';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import EmojiNatureIcon from '@mui/icons-material/EmojiNature';
import SettingsIcon from '@mui/icons-material/Settings';
import DashboardIcon from '@mui/icons-material/Dashboard';
import MapIcon from '@mui/icons-material/Map';
import ForestIcon from '@mui/icons-material/Forest';
import BuildIcon from '@mui/icons-material/Build';
import HomeWorkIcon from '@mui/icons-material/HomeWork';
import OpacityIcon from '@mui/icons-material/Opacity';
import EventIcon from '@mui/icons-material/Event';
import Inventory2Icon from '@mui/icons-material/Inventory2';
import PostAddIcon from '@mui/icons-material/PostAdd';
import PestControlIcon from '@mui/icons-material/PestControl';
import GrassIcon from '@mui/icons-material/Grass';
import BiotechIcon from '@mui/icons-material/Biotech';
import BugReportIcon from '@mui/icons-material/BugReport';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import GroupsIcon from '@mui/icons-material/Groups';
import AnalyticsIcon from '@mui/icons-material/Analytics';
import AgricultureIcon from '@mui/icons-material/Agriculture';
import PaidIcon from '@mui/icons-material/Paid';

export const navSections = [
  {
    title: 'Orchard',
    icon: ParkIcon,
    items: [
      { label: 'Dashboard', path: '/', icon: DashboardIcon, description: 'Overview and alerts' },
      { label: 'Tree Dashboard', path: '/orchard/map', icon: MapIcon, description: 'Tree locations and status on map' },
    ],
  },
  {
    title: 'Irrigation',
    icon: WaterDropIcon,
    items: [
      { label: 'Irrigation', path: '/irrigation/events', icon: EventIcon, description: 'Watering events' },
      { label: 'Fertigation', path: '/irrigation/fertigation', icon: ScienceIcon, description: 'Fertilizer through irrigation' },
    ],
  },
  {
    title: 'Inputs',
    icon: ScienceIcon,
    items: [
      { label: 'Inventory', path: '/inputs/inventory', icon: Inventory2Icon, description: 'Purchases and stock levels' },
      { label: 'Soil Application', path: '/inputs/soil-application', icon: GrassIcon, description: 'Direct fertilizer on soil' },
      { label: 'Spray', path: '/inputs/spray', icon: PestControlIcon, description: 'Plant protection' },
    ],
  },
  {
    title: 'Monitoring',
    icon: MonitorHeartIcon,
    items: [
      { label: 'Soil', path: '/monitoring/soil', icon: GrassIcon, description: 'Soil observations' },
      { label: 'Disease', path: '/monitoring/disease', icon: BugReportIcon, description: 'Health problems' },
      { label: 'Growth', path: '/monitoring/growth', icon: TrendingUpIcon, description: 'Tree growth trends' },
      { label: 'Alerts', path: '/monitoring/alerts', icon: NotificationsActiveIcon, description: 'Open action items' },
    ],
  },
  {
    title: 'Finance',
    icon: AccountBalanceIcon,
    items: [
      { label: 'Expenses', path: '/finance/expenses', icon: ReceiptLongIcon, description: 'Record spending' },
      { label: 'Labour', path: '/finance/labour', icon: GroupsIcon, description: 'Work and wages' },
      { label: 'Cost Analysis', path: '/finance/costs', icon: AnalyticsIcon, description: 'Cost per tree' },
    ],
  },
  {
    title: 'Production',
    icon: EmojiNatureIcon,
    items: [
      { label: 'Harvest', path: '/production/harvest', icon: AgricultureIcon, description: 'Yield records' },
      { label: 'Revenue', path: '/production/revenue', icon: PaidIcon, description: 'Sales income' },
    ],
  },
  {
    title: 'Farm Setting',
    icon: HomeWorkIcon,
    items: [
      { label: 'Farm Setup', path: '/orchard/setup', icon: BuildIcon, description: 'Blocks, rows, and lots' },
      { label: 'Trees', path: '/orchard/trees', icon: ForestIcon, description: 'Add and manage trees' },
      { label: 'Zones', path: '/irrigation/zones', icon: OpacityIcon, description: 'Drip lines and valves' },
      { label: 'Add Product', path: '/inputs/add-product', icon: PostAddIcon, description: 'Define products and nutrients' },
      { label: 'Add Soil Report', path: '/orchard/soil-report', icon: BiotechIcon, description: 'Sensor readings and lab reports' },
    ],
  },
  {
    title: 'Administration',
    icon: SettingsIcon,
    items: [
      { label: 'Settings', path: '/admin/settings', icon: SettingsIcon, description: 'Farm, varieties, sensors' },
    ],
  },
];

export function findNavItem(pathname) {
  if (pathname.startsWith('/tree/')) {
    return { label: 'Tree Dashboard', path: pathname, section: 'Orchard', icon: ForestIcon };
  }

  let best = null;
  navSections.forEach((section) => {
    section.items.forEach((item) => {
      const match = item.path === '/' ? pathname === '/' : pathname.startsWith(item.path);
      if (match && (!best || item.path.length > best.path.length)) {
        best = { ...item, section: section.title };
      }
    });
  });

  return best || { label: 'My Orchard', path: '/', section: 'Orchard', icon: DashboardIcon };
}

export const quickActions = [
  { label: 'Add Tree', path: '/orchard/trees', icon: ForestIcon },
  { label: 'Farm Setup', path: '/orchard/setup', icon: BuildIcon },
  { label: 'Irrigation Zone', path: '/irrigation/zones', icon: OpacityIcon },
  { label: 'Record Expense', path: '/finance/expenses', icon: ReceiptLongIcon },
];
