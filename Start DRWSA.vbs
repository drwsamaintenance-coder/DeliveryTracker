' Start DRWSA.vbs
' Double-click this file to start the DRWSA Maintenance Delivery Tracking System.
' It checks that Node.js is installed, installs dependencies the first time it is
' ever run, checks that your Firebase key is in place, then starts the server
' completely hidden (no black cmd window) and opens the app in your browser.
'
' IMPORTANT: this version uses Firebase/Firestore (a cloud database), so the
' host computer needs an internet connection every time the app runs — not
' just for first-time setup. If the internet goes down, the app will stop
' working until it's back.

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

' Always run from the folder this script lives in (the "drwsa" project folder)
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = scriptDir

' ---------- 1. Make sure Node.js is actually installed ----------
On Error Resume Next
Set nodeCheck = shell.Exec("cmd /c node -v")
Do While nodeCheck.Status = 0
  WScript.Sleep 100
Loop
nodeOk = (nodeCheck.ExitCode = 0)
On Error Goto 0

If Not nodeOk Then
  MsgBox "Node.js was not found on this computer." & vbCrLf & vbCrLf & _
         "DRWSA needs Node.js (v22.5 or newer) to run. Please install it from " & _
         "https://nodejs.org, then double-click Start DRWSA.vbs again.", vbCritical, "DRWSA - Node.js required"
  WScript.Quit 1
End If

' ---------- 2. Make sure your Firebase key is in place ----------
If Not fso.FileExists(scriptDir & "\serviceAccountKey.json") Then
  MsgBox "Missing serviceAccountKey.json." & vbCrLf & vbCrLf & _
         "This app now uses Firebase/Firestore instead of a local database file. " & _
         "Download your key from the Firebase Console (Project Settings > Service " & _
         "accounts > Generate new private key), rename it to serviceAccountKey.json, " & _
         "and place it in this same folder:" & vbCrLf & vbCrLf & scriptDir & vbCrLf & vbCrLf & _
         "Then double-click Start DRWSA.vbs again. See README.md for full steps.", _
         vbCritical, "DRWSA - Firebase key required"
  WScript.Quit 1
End If

' ---------- 3. First run only: install dependencies (needs internet) ----------
If Not fso.FolderExists(scriptDir & "\node_modules") Then
  result = MsgBox("Setting up DRWSA for the first time on this computer." & vbCrLf & vbCrLf & _
                   "This needs an internet connection to download the required packages. " & _
                   "A window will open to show progress — please wait for it to finish." & vbCrLf & vbCrLf & _
                   "Continue?", vbOKCancel + vbInformation, "DRWSA - First-time setup")
  If result = vbCancel Then WScript.Quit 0

  ' Run "npm install" in a VISIBLE window (1 = normal) so any error is visible,
  ' and wait (True) for it to finish before moving on.
  installExit = shell.Run("cmd /c npm install && pause", 1, True)

  If Not fso.FolderExists(scriptDir & "\node_modules") Then
    MsgBox "Setup did not finish successfully (no internet connection, or an error occurred)." & vbCrLf & vbCrLf & _
           "Please connect this computer to the internet and double-click Start DRWSA.vbs again.", _
           vbCritical, "DRWSA - Setup failed"
    WScript.Quit 1
  End If
End If

' ---------- 4. Start the server completely hidden ----------
logFile = scriptDir & "\server-log.txt"
shell.Run "cmd /c node server.js > """ & logFile & """ 2>&1", 0, False

' Give the server a few seconds to boot, checking the log for the "running on"
' message instead of just guessing a fixed delay.
started = False
For i = 1 To 20 ' up to ~10 seconds
  WScript.Sleep 500
  If fso.FileExists(logFile) Then
    On Error Resume Next
    Set f = fso.OpenTextFile(logFile, 1)
    logText = f.ReadAll
    f.Close
    On Error Goto 0
    If InStr(logText, "running on") > 0 Then
      started = True
      Exit For
    End If
    If InStr(logText, "Error") > 0 Or InStr(logText, "EADDRINUSE") > 0 Then
      Exit For
    End If
  End If
Next

If started Then
  shell.Run "http://localhost:3000/login.html", 1, False
Else
  MsgBox "DRWSA did not start correctly. Here is what the server log says:" & vbCrLf & vbCrLf & _
         logText & vbCrLf & vbCrLf & _
         "(Full log saved to server-log.txt in the DRWSA folder. If port 3000 is already " & _
         "in use, run Stop DRWSA.vbs first, then try again. If the log mentions Firebase " & _
         "or serviceAccountKey, double-check that file is in place and your internet " & _
         "connection is working.)", vbCritical, "DRWSA - Failed to start"
End If
