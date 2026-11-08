import { Config } from '@remotion/cli/config';

// Campaign assets are named relative to the campaign file, so the examples folder is the public
// folder for the bundled examples. A real render passes the folder that holds its own campaign.
Config.setPublicDir('../schema/examples');
Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(90);
