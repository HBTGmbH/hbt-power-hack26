import {makeStyles} from '@material-ui/core/styles';
import {PWR_ACCENT} from '../../PowerTheme';

const hexToRgbChannels = (hex: string) => [1, 3, 5].map(i => parseInt(hex.substr(i, 2), 16)).join(', ');

// The colours of the theme for index.css (#201), so they are defined in one place
const useStyles = makeStyles(theme => ({
    '@global': {
        ':root': {
            '--pwr-error': theme.palette.error.main,
            '--pwr-warning': theme.palette.warning.main,
            '--pwr-accent': PWR_ACCENT,
            '--pwr-primary': theme.palette.primary.main,
            '--pwr-primary-rgb': hexToRgbChannels(theme.palette.primary.main),
        },
    },
}));

/**
 * Publishes the primary, error, warning and accent colour of the theme as CSS variables (--pwr-primary,
 * --pwr-primary-rgb for translucent uses, --pwr-error, --pwr-warning,
 * --pwr-accent); rendered once inside the theme provider
 */
export const PwrThemeColors = () => {
    useStyles();
    return null;
};
