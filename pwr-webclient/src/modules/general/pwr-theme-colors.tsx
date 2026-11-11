import {makeStyles} from '@material-ui/core/styles';
import {PWR_ACCENT} from '../../PowerTheme';

// The colours of the theme for index.css (#201), so they are defined in one place
const useStyles = makeStyles(theme => ({
    '@global': {
        ':root': {
            '--pwr-error': theme.palette.error.main,
            '--pwr-warning': theme.palette.warning.main,
            '--pwr-accent': PWR_ACCENT,
            '--pwr-primary': theme.palette.primary.main,
            '--pwr-primary-contrast': theme.palette.primary.contrastText,
            '--pwr-secondary': theme.palette.secondary.main,
        },
    },
}));

/**
 * Publishes the error, warning, accent, primary, primary contrast and secondary colour of the theme as CSS variables (--pwr-error, --pwr-warning,
 * --pwr-accent, --pwr-primary, --pwr-primary-contrast, --pwr-secondary); rendered once inside the theme provider
 */
export const PwrThemeColors = () => {
    useStyles();
    return null;
};
