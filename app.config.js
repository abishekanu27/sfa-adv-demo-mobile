const fs = require('fs');
const path = require('path');

// mobile/app.config.js
module.exports = ({ config }) => {
  const variant = process.env.APP_VARIANT || 'live1';

  const clients = {
    live1: {
      name: 'SoftAir SFA',
      package: 'com.softair.sfa',
      icon: './assets/SoftAir_SFA.png',
      splash: './assets/clients/live1/splash.png',
    }
  };

  const client = clients[variant] || clients.live1;
  const defaultIcon = './assets/images/android-icon-foreground.png';
  const resolvedIcon = fs.existsSync(path.resolve(__dirname, client.icon)) ? client.icon : defaultIcon;

  return {
    ...config,
    name: client.name,
    android: {
      ...config.android,
      package: client.package,
      adaptiveIcon: {
        foregroundImage: resolvedIcon,
        backgroundColor: '#fdfbfbff'
      }
    }
  };
};
