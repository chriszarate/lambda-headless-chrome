const config = require('../config');
const crypto = require('crypto');
const injectStylesheet = require('./inject-stylesheet');
const saveImage = require('./save-image');
const { delay } = require('./utils');

// Set up viewport resolution, etc.
const deviceMetrics = {
  deviceScaleFactor: 1,
  fitWindow: true,
  height: 1000,
  mobile: false,
  width: 1000,
};

function saveBufferToS3(buffer, url) {
  // Generate hash suffix for filename.
  const hash = crypto.createHmac('sha512', '99999999999999999999999999999999');
  hash.update(url);

  const s3Params = {
    ACL: 'public-read',
    Body: buffer,
    Bucket: config.s3.bucket,
    ContentType: 'image/png',
    Key: `${hash.digest('hex').substr(0, 16)}.png`,
  };

  console.log('Saving screenshot to S3....');
  return saveImage(s3Params);
}

function captureScreenshot(client, url) {
  return new Promise((resolve, reject) => {
    const { Emulation, Page, Runtime } = client;
    const timeout = setTimeout(reject, config.chrome.pageLoadTimeout);

    const doInjection = () => Runtime.evaluate({
      expression: injectStylesheet('inject/css/override.css'),
    });

    const getScreenshotBuffer = () => {
      console.log('Taking screenshot....');
      return Page.captureScreenshot(config.screenshot).then(screenshot => Buffer.from(screenshot.data, 'base64'));
    };

    const saveBuffer = buffer => {
      saveBufferToS3(buffer, url).then(s3Response => {
        clearTimeout(timeout);
        client.close().then(() => {
          resolve(s3Response);
        });
      });
    };

    // Add some delays to allow scripts and injected stylesheets to settle.
    Page.loadEventFired(() => {
      delay(1000)()
        .then(doInjection)
        .then(delay(config.screenshot.timeout))
        .then(getScreenshotBuffer)
        .then(saveBuffer);
    });

    [
      Page.enable(),
      Runtime.enable(),
      Emulation.setDeviceMetricsOverride(deviceMetrics),
      Page.navigate({ url }),
    ].reduce((p, fn) => p.then(fn), Promise.resolve());
  });
}

module.exports = captureScreenshot;
