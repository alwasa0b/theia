REM TODO: adapt 'task' bash script to windows

REM SET @var="GREG"
REM ::instead of SET @var = "GREG"
REM ECHO %@var%

@echo off
for /l %%x in (%*) do (
   echo tasking... %%x
   timeout /t 1
)
