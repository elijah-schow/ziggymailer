/*
✓ Feedback (error, success)
✓ Copy and paste
✓ HTML

○ Ziggy app icon
○ Move "settings" button to a better place
○ Show success/failure for individual messages
○ Show sendgrid status for individual messages
○ Cancel submissions that are taking a long time
○ Security https://electronjs.org/docs/tutorial/security
○ Upgrade to latest node version
○ Fix jsx-a11y warnings
○ reset settings to defaults (except sendgrid and template key)
*/

import settings from 'electron-settings';
import fs from 'fs';
import { EOL } from 'os';
import path from 'path';
import csv from 'csv';
import { remote } from 'electron';
import React from 'react';
import { UncontrolledAlert, Modal, ModalHeader, ModalBody } from 'reactstrap';
import { find, values, defaultsDeep, uniq } from 'lodash';
import mail from '@sendgrid/mail';
import flat from 'flat';
import SimpleMDEReact from 'react-simplemde-editor';
import marked from 'marked';

const { dialog, Menu } = remote;

const DEFAULT_SETTINGS = {
  sendgridKey: '',
  from: 'ziggyonlinedebate@gmail.com',
  replyTo: 'ziggyonlinedebate@gmail.com',
  body: `Hello,
  
Your debate round {{Round}} pairing is as follows:

Affirmative **{{AFF.Team}}** vs. Negative **{{NEG.Team}}**
`,
  subject: 'Ziggy Debate - Postings',
  roundNumber: '1',
  teamFile: '',
  teamData: [],
  roundFile: '',
  roundData: [],
  settingsIsOpen: true,
  templateId: '',
};

/**
 * Add context menus to all inputs
 * source: https://github.com/electron/electron/issues/4068#issuecomment-170911307
 */
const InputMenu = Menu.buildFromTemplate([{
  label: 'Undo',
  role: 'undo',
}, {
  label: 'Redo',
  role: 'redo',
}, {
  type: 'separator',
}, {
  label: 'Cut',
  role: 'cut',
}, {
  label: 'Copy',
  role: 'copy',
}, {
  label: 'Paste',
  role: 'paste',
}, {
  type: 'separator',
}, {
  label: 'Select all',
  role: 'selectall',
},
]);

document.body.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  e.stopPropagation();

  let node = e.target;

  while (node) {
    if (node.nodeName.match(/^(input|textarea)$/i)
      || node.isContentEditable
      // Enable context menu on SimpleMDE
      || (node.classList && [...node.classList].includes('CodeMirror'))) {
      InputMenu.popup(remote.getCurrentWindow());
      break;
    }
    node = node.parentNode;
  }
});

/* Regex source: http://emailregex.com/ */
const emailRegex = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
const isEmail = value => emailRegex.test(value);

export default class App extends React.Component {
  static openFile(title = 'Open file', callback) {
    const options = {
      title,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    };
    dialog.showOpenDialog(options, (filenames) => {
      if (!filenames) return;
      const filename = filenames[0];
      fs.readFile(filename, (error, rawData) => {
        if (error) {
          dialog.showErrorBox('I had trouble opening the file.', error);
          App.log(error);
          return;
        }
        /* Auto-detect columns http://csv.adaltas.com/parse/ */
        const parseOptions = { columns: true };
        const parseCallback = (_error, data) => {
          if (_error) {
            dialog.showErrorBox('I had trouble parsing the file. It might not be a valid CSV.', _error);
            App.log(error);
            return;
          }
          callback({ data, filename });
        };
        csv.parse(rawData, parseOptions, parseCallback);
      });
    });
  }

  static log(...args) {
    console.error(...args);
    /* `EOL` stands for `end of line`. I'm using it because Windows and Unix use
    different line endings */
    const date = (new Date()).toString();
    const message = [...args]
      .map(error => `${error.message} - ${JSON.stringify(error)}`)
      .join(' ');
    const data = `${date} - ${message}${EOL}`;
    const filename = process.env.NODE_ENV === 'production'
      ? path.join(remote.app.getPath('userData'), 'error.log')
      : 'error.log';
    fs.appendFile(filename, data, (_error) => {
      if (_error) console.error('Couldn\'t write error log.');
    });
  }

  constructor(...args) {
    super(...args);

    // Load defaults from the application state
    this.state = defaultsDeep(
      settings.get('state'),
      DEFAULT_SETTINGS,
    );
    this.state.settingsIsOpen = this.state.sendgridKey.length === 0;
    this.state.status = 'idle'; // "idle" | "loading" | "success" | "error"
  }

  componentDidUpdate(props, state) {
    settings.set('state', state);
  }

  resetSettings(event) {
    if (event && event.preventDefault) {
      event.preventDefault();
    }
    dialog.showMessageBox(
      remote.getCurrentWindow(),
      {
        type: 'question',
        buttons: ['Yes', 'No'],
        title: 'Confirm',
        message: 'Shoud I reset everything? This includes all settings, the subject line, and your artisnal, hand-crafted message body.',
      },
      (response) => {
        // if the "yes" button was clicked
        if (response === 0) {
          this.setState(DEFAULT_SETTINGS);
          settings.set('state', DEFAULT_SETTINGS);
        }
      },
    );
  }

  submit(event) {
    this.setState(state => ({ ...state, status: 'loading' }));

    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    const rounds = this.state.roundData;
    const teams = this.state.teamData;
    const Round = this.state.roundNumber;
    const roundPromises = rounds.map((round) => {
      try {
        const AFF = find(teams, ({ Team }) => Team && Team === round.AFF);
        const NEG = find(teams, ({ Team }) => Team && Team === round.NEG);
        if (!AFF) {
          return Promise.reject(new Error(`Could not find AFF team ${round && round.AFF}. Make sure they match in the round and team file.`));
        }
        if (!NEG) {
          return Promise.reject(new Error(`Could not find NEG team ${round && round.NEG}. Make sure they match in the round and team file.`));
        }

        /* Extract all unique email addresses from both teams */
        const emails = uniq(values(NEG).concat(values(AFF)).filter(isEmail));
        if (emails.length === 0) {
          return Promise.rejeect(new Error(`I did not find email addresses for ${AFF && AFF.Team} and ${NEG && NEG.Team}. Add some then try again.`));
        }

        /* Convert markdown to HTML */
        const html = marked(this.state.body);

        const message = {
          from: this.state.from,
          to: emails,
          /* SendGrid doesn't support reply-to multiple addresses:
          https://github.com/sendgrid/sendgrid-csharp/issues/339 */
          // replyTo: emails,
          subject: this.state.subject,
          html,
          substitutions: flat({
            Round,
            AFF,
            NEG,
          }),
        };

        if (this.state.templateId && this.state.templateId.length > 0) {
          message.templateId = this.state.templateId;
        }

        mail.setApiKey(this.state.sendgridKey);
        return mail.send(message);
        // return timeout(100000); // this is for testing without spamming the API
      } catch (error) {
        return Promise.reject(error);
      }
    });

    Promise.all(roundPromises)
      .then((success) => {
        this.setState(state => ({
          ...state,
          status: 'success',
          success,
        }));
      })
      .catch((error) => {
        this.setState(state => ({
          ...state,
          status: 'error',
          error,
        }));
        App.log(error);
      });
  }

  canSubmit() {
    return this.state.sendgridKey
      && this.state.sendgridKey.length > 0
      && this.state.roundData.length > 0
      && this.state.teamData.length > 0;
  }

  toggleSettings(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    this.setState({ settingsIsOpen: !this.state.settingsIsOpen });
  }

  change(event) {
    const target = event.currentTarget;
    const value = target.type === 'checkbox' ? target.checked : target.value;
    const name = target.name;
    this.setState(state => ({
      ...state,
      [name]: value,
    }));
  }

  openTeamFile(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    App.openFile('Team file', ({ data, filename }) => this.setState(state => ({
      ...state,
      teamFile: filename,
      teamData: data,
    })));
  }

  openRoundFile(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    App.openFile('Round file', ({ data, filename }) => this.setState(state => ({
      ...state,
      roundFile: filename,
      roundData: data,
    })));
    // TODO: throw an error if columns are missing
  }

  isIdle() {
    return this.state.status === 'idle';
  }

  isLoading() {
    return this.state.status === 'loading';
  }

  isError() {
    return this.state.status === 'error';
  }

  isSuccess() {
    return this.state.status === 'success';
  }

  render() {
    return (
      <div>
        <div className="container p-5">
          <h1>Ziggy Mailer</h1>
          <form onSubmit={e => this.submit(e)}>

            <div className="row">
              <div className="form-group col-sm-6">
                <label htmlFor="from">From</label>
                <input
                  name="from"
                  type="email"
                  id="from"
                  className="form-control"
                  value={this.state.from}
                  onChange={e => this.change(e)}
                />
              </div>
              <div className="form-group col-sm-6">
                <label htmlFor="reply-to">Reply to</label>
                <input
                  name="replyTo"
                  type="email"
                  id="reply-to"
                  className="form-control"
                  value={this.state.replyTo}
                  onChange={e => this.change(e)}
                />
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="subject">Subject</label>
              <input
                name="subject"
                type="text"
                id="subject"
                className="form-control"
                value={this.state.subject}
                onChange={e => this.change(e)}
              />
            </div>

            <div className="form-group">
              <SimpleMDEReact
                name="body"
                label="Body"
                id="message-body"
                value={this.state.body}
                onChange={value => this.setState(state => ({
                  ...state,
                  body: value,
                }))}
              />
            </div>

            <div className="row">

              <div className="form-group col-sm-4">
                <label htmlFor="round-number">Round Number</label>
                <input
                  name="roundNumber"
                  type="number"
                  id="round-number"
                  className="form-control"
                  value={this.state.roundNumber}
                  onChange={e => this.change(e)}
                />
              </div>

              <div className="form-group col-sm-4">
                <label htmlFor="round-file">Round File</label>
                <button
                  id="round-file"
                  className="btn btn-block"
                  type="button"
                  onClick={e => this.openRoundFile(e)}
                >
                  Open
                </button>
                <p>{path.basename(this.state.roundFile)}</p>
                {this.state.roundData.length > 0 &&
                  <p>{this.state.roundData.length} room(s)</p>}
              </div>

              <div className="form-group col-sm-4">
                <label htmlFor="team-file">Team File</label>
                <button
                  id="team-file"
                  className="btn btn-block"
                  type="button"
                  onClick={e => this.openTeamFile(e)}
                >
                  Open
                </button>
                <p>{path.basename(this.state.teamFile)}</p>
                {this.state.teamData.length > 0 &&
                  <p>{this.state.teamData.length} teams(s)</p>}
              </div>

            </div>

            <button className="btn btn-link btn-block" onClick={e => this.toggleSettings(e)}>Settings</button>
            <button type="submit" className="btn btn-primary btn-block" disabled={!this.canSubmit() || this.isLoading()}>
              Send Emails
              &nbsp;{this.isLoading() && <div className="loader" />}
            </button>
            {this.isError() &&
              <UncontrolledAlert color="danger">
                <strong>I had a problem</strong>
                {(this.state.error && `: ${this.state.error.message}`) || ', but I don\'t know what it was 🤔'}
              </UncontrolledAlert>}
            {this.isSuccess() &&
              <UncontrolledAlert color="success">
                <strong>I sent {this.state.success.length} emails. </strong>
                Check your sendgrid dashboard for more details.
              </UncontrolledAlert>
            }
          </form>
        </div>

        <Modal isOpen={this.state.settingsIsOpen}>
          <form onSubmit={this.submitSettings}>
            <ModalHeader toggle={e => this.toggleSettings(e)}>Settings</ModalHeader>
            <ModalBody>
              <div className="form-group">
                <label htmlFor="sendgrid-key">Sendgrid API Key</label>
                <input
                  type="password"
                  name="sendgridKey"
                  id="sendgrid-key"
                  onChange={e => this.change(e)}
                  value={this.state.sendgridKey}
                  className="form-control"
                />
                <small className="help-text">
                  {this.canSubmit()
                    ? <span>I automatically saved your key.</span>
                    : <span>I won&apos;t be able to send email without it.</span>
                  }
                </small>
              </div>
              <div className="form-group">
                <label htmlFor="sendgrid-template-id">Sendgrid Template ID (optional)</label>
                <input
                  type="text"
                  name="templateId"
                  id="sendgrid-template-id"
                  onChange={e => this.change(e)}
                  value={this.state.templateId}
                  className="form-control"
                />
              </div>
              <button className="btn btn-danger" type="button" onClick={e => this.resetSettings(e)}>Reset everything</button>
            </ModalBody>
          </form>
        </Modal>

      </div>
    );
  }
}
