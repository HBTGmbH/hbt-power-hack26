import {createTheme, ThemeOptions} from '@material-ui/core/styles';

// The pink palette, defined once; overrides and index.css (via --pwr-* variables) read it
const PRIMARY_LIGHT = '#E35183';
const PRIMARY_MAIN = '#AD1457';
const PRIMARY_DARK = '#78002E';
const SECONDARY_LIGHT = '#FFE0EB';
const SECONDARY_MAIN = '#F8BBD0';
const SECONDARY_DARK = '#C48B9F';

const newPowerTheme: ThemeOptions = {
    typography: {
        fontSize: 24,
        fontFamily: [
            'Roboto',
            'sans-serif',].join(','),
    },
    palette: {
        primary: {
            light: PRIMARY_LIGHT,
            main: PRIMARY_MAIN,
            dark: PRIMARY_DARK,
            contrastText: '#fff',
        },
        secondary: {
            light: SECONDARY_LIGHT,
            main: SECONDARY_MAIN,
            dark: SECONDARY_DARK,
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
                color: '#fff',
                indicatorColor: SECONDARY_MAIN,
                backgroundColor: PRIMARY_MAIN
            }
        },
        MuiTab: {
            root: {
                '&$selected': {
                    color: SECONDARY_MAIN
                }
            }

        }
    }
};

export const POWER_MUI_THEME = createTheme(newPowerTheme as any);

/**
 * The HBT orange (#201): an accent only, e.g. a bar or a border next to text in the normal text colour, or an area with
 * dark blue text on it (6.7:1). Never the colour of text and never behind white text: 2.3:1 on white.
 */
export const PWR_ACCENT = '#ff8e01';
