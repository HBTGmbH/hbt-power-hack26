import {createTheme, ThemeOptions} from '@material-ui/core/styles';

/**
 * The HBT orange (#201): an accent and the primary colour. Surfaces in it carry dark blue text (6.7:1), never white
 * (2.3:1), and it is never the colour of text on white.
 */
export const PWR_ACCENT = '#ff8e01';
// Dark blue: text on orange surfaces and dark text in general
const PWR_DARK_BLUE = '#191E55';
// Dark orange for controls and graphics on white: 3.7:1
const PWR_DARK_ORANGE = '#c66e00';

const newPowerTheme: ThemeOptions = {
    typography: {
        fontSize: 24,
        fontFamily: [
            'Roboto',
            'sans-serif',].join(','),
    },
    palette: {
        primary: {
            light: '#ffa933',
            main: PWR_ACCENT,
            dark: PWR_DARK_ORANGE,
            contrastText: PWR_DARK_BLUE,
        },
        secondary: {
            // Dark orange: 6.4:1 on white, white text on it 6.4:1
            light: PWR_DARK_ORANGE,
            main: '#8f4e00',
            dark: '#5c3200',
            contrastText: '#fff',
        },
        // Errors and destructive actions in red (#201): 7.3:1 on white, 6.0:1 on the grey of the fields, white
        // text on it 7.3:1. Not the HBT orange, which reaches only 2.3:1 (see PWR_ACCENT).
        error: {
            main: '#B00020',
        },
        // Warnings that are no errors (outdated, can't be undone), dark orange: 5.3:1 on white
        warning: {
            main: '#A85400',
        },
        text: {

            //disabled: Color.HBT_2017_GRAY.toCSSRGBAString(0.5),
        }
    },
    props: {
        MuiPaper: {
            square: true
        },
        // Grey area instead of only an underline, so input fields are easy to spot (#56). Also used by the date pickers.
        MuiTextField: {
            variant: 'filled'
        }
    },
    overrides: {
        // A grey area marks a field you can type in: disabled fields have none, so e.g. the read mode of a form
        // is easy to tell apart from its edit mode
        MuiFilledInput: {
            root: {
                '&$disabled': {
                    backgroundColor: 'transparent'
                }
            }
        },
        MuiInputAdornment: {
            root: {
                height: 'auto'
            }
        },
        // Card buttons in line with the card header (16 px) (#41)
        MuiCardActions: {
            root: {
                padding: '8px 16px 16px'
            }
        },
        // Dialog buttons in line with the fields of the dialog content (24 px), 16 px below them (#41)
        MuiDialogActions: {
            root: {
                padding: '8px 24px 16px'
            }
        },
        // Multi-line fields can be made taller or shorter by dragging their corner (#107). Fields with a fixed
        // number of rows only: an auto-sizing one recomputes its height on every input
        MuiInputBase: {
            inputMultiline: {
                resize: 'vertical'
            }
        },
        MuiTabs: {
            root: {
                color: PWR_DARK_BLUE,
                indicatorColor: PWR_DARK_BLUE,
                backgroundColor: PWR_ACCENT
            }
        },
        MuiTab: {
            root: {
                '&$selected': {
                    color: PWR_DARK_BLUE
                }
            }

        },
        // Orange is never the colour of text on white: text and outlined buttons in the primary colour use dark blue
        MuiButton: {
            textPrimary: {
                color: PWR_DARK_BLUE
            },
            outlinedPrimary: {
                color: PWR_DARK_BLUE
            }
        },
        // Focused labels would turn orange on white or grey: dark blue instead
        MuiFormLabel: {
            root: {
                '&$focused': {
                    color: PWR_DARK_BLUE
                }
            }
        },
        // Controls and icons in the primary colour on white need 3:1: dark orange instead of the HBT orange
        MuiIconButton: {
            colorPrimary: {
                color: PWR_DARK_ORANGE
            }
        },
        MuiCheckbox: {
            colorPrimary: {
                '&$checked': {
                    color: PWR_DARK_ORANGE
                }
            }
        },
        MuiRadio: {
            colorPrimary: {
                '&$checked': {
                    color: PWR_DARK_ORANGE
                }
            }
        },
        MuiSwitch: {
            colorPrimary: {
                '&$checked': {
                    color: PWR_DARK_ORANGE
                },
                '&$checked + $track': {
                    backgroundColor: PWR_DARK_ORANGE
                }
            }
        }
    }
};

export const POWER_MUI_THEME = createTheme(newPowerTheme as any);
