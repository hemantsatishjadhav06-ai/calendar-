import { builder } from '../builder.js';
import './enums.js';
import './organization.js';
import './channels.js';
import './posts.js';
import './queue.js';
import './calendar.js';
import './ideas.js';
import './tags.js';
import './community.js';
import './insights.js';
import './settings.js';
import './startpage.js';

export const schema = builder.toSchema();
