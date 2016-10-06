import sys
import csv
import os
import sendgrid
from sendgrid.helpers.mail import *

import tkinter as tk
from tkinter.filedialog import askopenfilename
from tkinter import messagebox

sg = sendgrid.SendGridAPIClient(apikey='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')

class ZiggyMailer:
    # Define the GUI
    def __init__(self, root):
        # Defaults
        default = {
            'from_email' : 'ziggyonlinedebate@gmail.com',
            'subject' : 'Ziggy Debate - Postings',
            'information' : '',
            'round_number' : 1,
            'round_file' : 'data/Round.csv',
            'team_file' : 'data/Team Data.csv',
        }
        #Define root
        self.root = root
        # Left column
        self.leftFrame = tk.Frame(root)
        self.leftFrame.grid(row=0, column=0, sticky='NW', padx=(10,5))
        #From Input
        value = tk.StringVar(root, default['from_email'])
        self.fromLabel = tk.Label(self.leftFrame, text='From')
        self.fromEntry = tk.Entry(self.leftFrame, textvariable=value)
        self.fromLabel.grid(sticky='W', pady=(5,0))
        self.fromEntry.grid(sticky='WE', pady=(0,5))
        # Subject Input
        value = tk.StringVar(root, default['subject'])
        self.subjectLabel = tk.Label(self.leftFrame, text='Subject')
        self.subjectEntry = tk.Entry(self.leftFrame, textvariable=value)
        self.subjectLabel.grid(sticky='W', pady=(5,0))
        self.subjectEntry.grid(sticky='WE', pady=(0,5))
        #Information Input
        self.informationLabel = tk.Label(self.leftFrame, text='Information')
        self.informationText = tk.Text(self.leftFrame)
        self.informationLabel.grid(sticky='W', pady=(5,0))
        self.informationText.grid(sticky='WE', pady=(0,5))
        # Right column
        self.rightFrame = tk.Frame(root)
        self.rightFrame.grid(row=0, column=1, sticky='NW', padx=(5, 10))
        # Round Number Input
        value = tk.StringVar(root, default['round_number'])
        self.roundLabel = tk.Label(self.rightFrame, text='Round Number')
        self.roundEntry = tk.Entry(self.rightFrame, textvariable=value)
        self.roundLabel.grid(row='0', sticky='W', pady=(5,0), columnspan=2)
        self.roundEntry.grid(row='1', sticky='WE', pady=(0,5), columnspan=2)
        # Round File Input
        value = tk.StringVar(root, default['round_file'])
        self.roundFileLabel = tk.Label(self.rightFrame, text='Round File (.csv)')
        self.roundFileButton = tk.Button(self.rightFrame, text="Open",
            command=lambda:self.setfilename(self.roundFileEntry))
        self.roundFileEntry = tk.Entry(self.rightFrame, state='disabled',
            textvariable=value)
        self.roundFileLabel.grid(row='2', sticky='W', pady=(5,0), columnspan=2)
        self.roundFileButton.grid(row='3', column=0)
        self.roundFileEntry.grid(row='3', column=1, sticky="NSEW")
        # Team File Input
        value = tk.StringVar(root, default['team_file'])
        self.teamFileLabel = tk.Label(self.rightFrame, text='Team File (.csv)')
        self.teamFileButton = tk.Button(self.rightFrame, text="Open",
            command=lambda:self.setfilename(self.teamFileEntry))
        self.teamFileEntry = tk.Entry(self.rightFrame, state='disabled',
            textvariable=value)
        self.teamFileLabel.grid(row='4', sticky='W', pady=(5,0), columnspan=2)
        self.teamFileButton.grid(row='5', column=0)
        self.teamFileEntry.grid(row='5', column=1, sticky="NSEW")
        # Submit button
        self.submitButton = tk.Button(root, text='Send', command=self.submit )
        self.submitButton.grid(stick='WE', row=1,columnspan=2, padx=10, pady=10)

    # Update a file name input
    def setfilename(self, target):
        # TODO: assert that 'target' is an instance of tk.Entry
        filename = askopenfilename(filetypes=[('Comma Separated Values', '*.csv')])
        target.configure(state = 'normal') # text can't be edited if it's disabled
        target.delete(0, 'end')
        target.insert(0, filename)
        target.xview('end')
        target.configure(state = 'disabled')

    # Load a CSV file into a Python data structure
    def readCSV(self, file_name):
        result = []
        with open(file_name, 'r') as file:
            reader = csv.DictReader(file)
            for room in reader:
                result.append(room)
        return result

    # Gather the form's inputs and send emails
    def submit(self):
        from_email = self.fromEntry.get()
        subject = self.subjectEntry.get()
        information = self.informationText.get('1.0', 'end')
        round_number = int(self.roundEntry.get())
        round_file = self.roundFileEntry.get()
        team_file = self.teamFileEntry.get()

        try:
            result = self.sendmail(from_email, subject, information,
            round_number, round_file, team_file )
        except  AssertionError as error:
            print (error)
            tk.messagebox.showerror('Error', error)

        tk.messagebox.showinfo( 'Message Sent', 'The message was sent to %i rooms and %i participants.'
            % (result[0], result[1]) )

    # E-mail postings to all the participants
    def sendmail( self, from_email, subject, information, round_number,
        round_file, team_file ):
        assert os.path.isfile(team_file), 'The Team Data file does not exist. Make sure one is selected.'
        assert os.path.isfile(round_file), 'The Round File does not exist. Make sure one is selected.'
        assert from_email, 'There is no "from" address. Please specify one.'
        assert subject, 'The subject is empty. Please write a suject line.'
        assert round_number, 'There is no round number. Please specify one.'

        team_data = self.readCSV( team_file )
        round_data = self.readCSV( round_file )

        keys = ["Team", "Email 1", "Email 2"]
        for key in keys:
            assert key in team_data[0], 'The team data file is not formatted correctly. Make sure it contains this column (case-sensitive): "%s"' % key
        keys = ["AFF", "NEG"]
        for key in keys:
            assert key in round_data[0], 'The round data file is not formatted correctly. Make sure it contains this column (case-sensitive): "%s"' % key
        room_count = len( round_data )
        assert( room_count < 3000 )

        participant_count = 0
        for room in round_data:
            # Find the e-mails of everyone in this room
            recipients = []
            for row in team_data:
                if row['Team']==room['AFF'] or row['Team']==room['NEG']:
                    keys = ['Email 1', 'Email 2']
                    for key in keys:
                        # Don't add blank email addresses
                        if row[key]: recipients.append( row[key] )
                        participant_count += 1
            assert len(recipients) > 0, 'There are no recipients. Double check the Team File and Round File for errors.'
            to_emails = str(recipients).strip('[]').replace('\'', '')
            if __debug__:print(recipients)
            if __debug__:print(to_emails)

            # Format the message
            message = '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>\
                       <body>\
                            <p>Hello,</p>\
                            <p>Your debate round %r pairing is as follows: \
                            Affirmative %s vs. Negative %s.</p>\
                            <p>%s</p>\
                        </body></html>'\
                        % (round_number, room['AFF'], room['NEG'], information)

            # Send the message
            mail = Mail( Email(from_email), subject, Email(to_emails),
                Content('text/html', message ) )
            response = sg.client.mail.send.post(request_body=mail.get())
            if __debug__:
                print(response.status_code)
                print(response.body)
                print(response.headers)

        return (room_count, participant_count)

"""Main Loop"""
root = tk.Tk()
root.wm_title('Ziggy Mailer')
app = ZiggyMailer(root)
root.mainloop()
