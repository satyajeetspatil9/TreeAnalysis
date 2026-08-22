import { createTheme, alpha } from '@mui/material/styles';

const green = '#8BC34A';
const greenDark = '#689F38';
const gold = '#FFC107';

export const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: green,
      dark: greenDark,
      light: '#AED581',
      contrastText: '#0a0a0a',
    },
    secondary: {
      main: gold,
      contrastText: '#0a0a0a',
    },
    success: { main: '#66BB6A' },
    warning: { main: '#FFA726' },
    error: { main: '#EF5350' },
    info: { main: '#42A5F5' },
    background: {
      default: '#0a0a0a',
      paper: '#141414',
    },
    text: {
      primary: '#f5f5f5',
      secondary: alpha('#ffffff', 0.65),
    },
    divider: alpha('#ffffff', 0.08),
  },
  typography: {
    fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
    fontSize: 15,
    h4: { fontWeight: 700, letterSpacing: '-0.02em' },
    h5: { fontWeight: 700 },
    h6: { fontWeight: 600 },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  shape: { borderRadius: 12 },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          fontSize: '15px',
          scrollbarColor: '#333 #0a0a0a',
        },
        '#root': {
          minHeight: '100vh',
        },
      },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          border: `1px solid ${alpha('#ffffff', 0.08)}`,
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: '#0f0f0f',
          borderBottom: `1px solid ${alpha('#ffffff', 0.08)}`,
          boxShadow: 'none',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: '#0f0f0f',
          borderRight: `1px solid ${alpha('#ffffff', 0.08)}`,
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 10,
          marginInline: 8,
          marginBlock: 2,
          '&.Mui-selected': {
            backgroundColor: alpha(green, 0.14),
            '&:hover': {
              backgroundColor: alpha(green, 0.2),
            },
          },
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: { borderRadius: 10 },
      },
    },
    MuiTextField: {
      defaultProps: { variant: 'outlined' },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          fontSize: '0.9375rem',
        },
        head: {
          fontWeight: 600,
          fontSize: '0.9375rem',
          color: alpha('#ffffff', 0.7),
          backgroundColor: alpha('#ffffff', 0.03),
        },
      },
    },
    MuiInputBase: {
      styleOverrides: {
        root: {
          fontSize: '0.9375rem',
        },
        input: {
          fontSize: '0.9375rem',
        },
      },
    },
    MuiInputLabel: {
      styleOverrides: {
        root: {
          fontSize: '0.9375rem',
        },
      },
    },
    MuiMenuItem: {
      styleOverrides: {
        root: {
          fontSize: '0.9375rem',
        },
      },
    },
    MuiListItemText: {
      styleOverrides: {
        primary: {
          fontSize: '0.9375rem',
        },
        secondary: {
          fontSize: '0.8125rem',
        },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          fontSize: '0.9375rem',
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 500, fontSize: '0.8125rem' },
        label: { fontSize: '0.8125rem' },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: { borderRadius: 10, fontSize: '0.9375rem' },
      },
    },
  },
});
