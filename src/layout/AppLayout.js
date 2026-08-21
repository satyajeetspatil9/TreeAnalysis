import React, { useState } from 'react';

import { Link as RouterLink, Outlet, useLocation } from 'react-router-dom';

import {

  AppBar, Avatar, Box, Drawer, IconButton, List, ListItemButton, ListItemIcon,

  ListItemText, Toolbar, Typography, Divider, useTheme, useMediaQuery, Button,

  Chip, Tooltip,

} from '@mui/material';

import MenuIcon from '@mui/icons-material/Menu';

import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';

import { navSections, findNavItem } from './navConfig';

import { useAuth } from '../contexts/AuthContext';

import { useFarm } from '../hooks/useFarm';



const DRAWER_WIDTH = 280;



function AppLayout() {

  const [mobileOpen, setMobileOpen] = useState(false);

  const location = useLocation();

  const theme = useTheme();

  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const { user } = useAuth();

  const { farm } = useFarm();

  const page = findNavItem(location.pathname);

  const PageIcon = page.icon;



  const drawer = (

    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>

      <Toolbar sx={{ px: 2, minHeight: { xs: 64, sm: 72 } }}>

        <Box>

          <Typography variant="h6" noWrap sx={{ fontWeight: 800, lineHeight: 1.2 }}>

            🥭 My Orchard

          </Typography>

          <Typography variant="caption" color="text.secondary" noWrap>

            {farm?.name || 'Set up your farm in Settings'}

          </Typography>

        </Box>

      </Toolbar>

      <Divider />

      <Box sx={{ overflow: 'auto', flex: 1, py: 1.5 }}>

        {navSections.map((section) => {

          const SectionIcon = section.icon;

          return (

            <Box key={section.title} sx={{ mb: 1.5 }}>

              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 0.75 }}>

                <SectionIcon sx={{ fontSize: 16, color: 'primary.main' }} />

                <Typography

                  variant="overline"

                  sx={{ color: 'text.secondary', fontWeight: 700, letterSpacing: 1 }}

                >

                  {section.title}

                </Typography>

              </Box>

              <List dense disablePadding>

                {section.items.map((item) => {

                  const ItemIcon = item.icon;

                  const selected =

                    item.path === '/'

                      ? location.pathname === '/'

                      : location.pathname.startsWith(item.path);

                  return (

                    <Tooltip key={item.path} title={item.description || item.label} placement="right">

                      <ListItemButton

                        component={RouterLink}

                        to={item.path}

                        selected={selected}

                        onClick={() => isMobile && setMobileOpen(false)}

                        sx={{

                          pl: 2.5,

                          ...(selected && {

                            borderLeft: '3px solid',

                            borderColor: 'primary.main',

                            pl: 'calc(20px - 3px)',

                          }),

                        }}

                      >

                        <ListItemIcon sx={{ minWidth: 36, color: selected ? 'primary.main' : 'text.secondary' }}>

                          <ItemIcon fontSize="small" />

                        </ListItemIcon>

                        <ListItemText

                          primary={item.label}

                          primaryTypographyProps={{ variant: 'body2', fontWeight: selected ? 600 : 400 }}

                        />

                      </ListItemButton>

                    </Tooltip>

                  );

                })}

              </List>

            </Box>

          );

        })}

      </Box>

      <Divider />

      <Box sx={{ p: 2 }}>

        <Typography variant="caption" color="text.secondary" display="block" noWrap>

          {user?.email}

        </Typography>

      </Box>

    </Box>

  );



  return (

    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>

      <AppBar

        position="fixed"

        sx={{

          width: { md: `calc(100% - ${DRAWER_WIDTH}px)` },

          ml: { md: `${DRAWER_WIDTH}px` },

        }}

      >

        <Toolbar>

          <IconButton

            color="inherit"

            edge="start"

            onClick={() => setMobileOpen(!mobileOpen)}

            sx={{ mr: 2, display: { md: 'none' } }}

            aria-label="Open navigation menu"

          >

            <MenuIcon />

          </IconButton>



          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexGrow: 1, minWidth: 0 }}>

            {PageIcon && <PageIcon sx={{ color: 'primary.main', display: { xs: 'none', sm: 'block' } }} />}

            <Box sx={{ minWidth: 0 }}>

              <Typography variant="h6" noWrap sx={{ fontWeight: 700, lineHeight: 1.2 }}>

                {page.label}

              </Typography>

              <Typography variant="caption" color="text.secondary" noWrap sx={{ display: { xs: 'none', sm: 'block' } }}>

                {page.section}{page.description ? ` · ${page.description}` : ''}

              </Typography>

            </Box>

          </Box>



          {farm?.name && (

            <Chip

              label={farm.name}

              size="small"

              sx={{ mr: 2, display: { xs: 'none', lg: 'inline-flex' } }}

              color="primary"

              variant="outlined"

            />

          )}



          <Button

            color="inherit"

            component={RouterLink}

            to="/admin/settings"

            size="small"

            startIcon={<SettingsOutlinedIcon />}

            sx={{ display: { xs: 'none', sm: 'inline-flex' } }}

          >

            Settings

          </Button>



          <Tooltip title="Settings">

            <IconButton

              color="inherit"

              component={RouterLink}

              to="/admin/settings"

              sx={{ display: { xs: 'inline-flex', sm: 'none' }, ml: 1 }}

            >

              <SettingsOutlinedIcon />

            </IconButton>

          </Tooltip>



          <Avatar

            sx={{

              ml: 1.5,

              width: 32,

              height: 32,

              bgcolor: 'primary.main',

              color: 'primary.contrastText',

              fontSize: '0.875rem',

              fontWeight: 700,

              display: { xs: 'none', md: 'flex' },

            }}

          >

            {(user?.email || '?')[0].toUpperCase()}

          </Avatar>

        </Toolbar>

      </AppBar>



      <Box component="nav" sx={{ width: { md: DRAWER_WIDTH }, flexShrink: { md: 0 } }}>

        <Drawer

          variant="temporary"

          open={mobileOpen}

          onClose={() => setMobileOpen(false)}

          ModalProps={{ keepMounted: true }}

          sx={{

            display: { xs: 'block', md: 'none' },

            '& .MuiDrawer-paper': { boxSizing: 'border-box', width: DRAWER_WIDTH },

          }}

        >

          {drawer}

        </Drawer>

        <Drawer

          variant="permanent"

          sx={{

            display: { xs: 'none', md: 'block' },

            '& .MuiDrawer-paper': { boxSizing: 'border-box', width: DRAWER_WIDTH },

          }}

          open

        >

          {drawer}

        </Drawer>

      </Box>



      <Box

        component="main"

        sx={{

          flexGrow: 1,

          p: { xs: 2, sm: 3 },

          width: { md: `calc(100% - ${DRAWER_WIDTH}px)` },

          mt: { xs: 7, sm: 8 },

          minHeight: '100vh',

        }}

      >

        <Outlet />

      </Box>

    </Box>

  );

}



export default AppLayout;

