"""Configure registered device identity without reading or storing logins."""
import json
from pathlib import Path
from settings import HOME, settings

def configure():
    import tkinter as tk
    from tkinter import messagebox
    root=tk.Tk();root.title('Oraforge eTIMS Windows Helper');root.resizable(False,False)
    current=settings();values={}
    fields=[('taxpayer_pin','Registered seller KRA PIN'),('branch_id','Registered branch (two digits)'),
            ('installation_dir','Installed eTIMS folder'),('database_path','Existing eTIMS database path')]
    for row,(key,label) in enumerate(fields):
        tk.Label(root,text=label,anchor='w').grid(row=row,column=0,padx=12,pady=8,sticky='w')
        value=tk.StringVar(value=current.get(key,''));values[key]=value
        tk.Entry(root,textvariable=value,width=58).grid(row=row,column=1,padx=12,pady=8)
    def save():
        import re
        try:
            result={**current,**{key:value.get().strip() for key,value in values.items()}}
            result['taxpayer_pin']=result['taxpayer_pin'].upper()
            if not re.fullmatch(r'[A-Z]\d{9}[A-Z]',result['taxpayer_pin']):raise ValueError('Enter this device\'s registered seller PIN')
            if not re.fullmatch(r'\d{2}',result['branch_id']):raise ValueError('Enter the registered two-digit branch ID')
            if not (Path(result['installation_dir'])/'bin/EBM2x.dll').is_file():raise ValueError('Select the installed eTIMS folder')
            if not Path(result['database_path']).is_file():raise ValueError('Select the existing database file; no database will be created')
            HOME.mkdir(parents=True,exist_ok=True)
            temporary=HOME/'config.next';temporary.write_text(json.dumps(result,indent=2),encoding='utf-8');temporary.replace(HOME/'config.json')
            messagebox.showinfo('Saved','Helper identity saved. Restart the helper if you changed its port. eTIMS registration and login credentials were not changed.')
            root.destroy()
        except ValueError as error:messagebox.showerror('Settings',str(error))
        except OSError:messagebox.showerror('Settings','Could not save the helper configuration')
    tk.Button(root,text='Save helper configuration',command=save).grid(row=len(fields),column=1,padx=12,pady=14,sticky='e')
    root.mainloop()

def check(output=None):
    from display import machine_check
    report=machine_check()
    report['ready']=report['ready'] and report['build_matches']
    text=json.dumps(report,indent=2)
    if output:
        output=Path(output);output.parent.mkdir(parents=True,exist_ok=True)
        output.write_text(text,encoding='utf-8')
    print(text)
    return 0 if report['ready'] else 2

if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check',action='store_true',help='Read-only display/build/printer/current-profile check')
    parser.add_argument('--output',type=Path)
    args=parser.parse_args()
    if args.check:raise SystemExit(check(args.output))
    configure()
