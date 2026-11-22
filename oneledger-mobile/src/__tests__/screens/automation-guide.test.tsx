import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { AutomationGuide } from '@/features/ios-shortcuts/AutomationGuide';
it('explains the blocking condition, shortcut selection, message input and separate tests', async () => {
 const next=jest.fn();await render(<AutomationGuide majorVersion={27} onNext={next}/>);
 expect(screen.getByText('Open your Message automation')).toBeTruthy();
 await fireEvent.press(screen.getByText('Next instruction'));
 expect(screen.getByRole('alert')).toHaveTextContent(/Configure Sender/);
 await fireEvent.press(screen.getByText('Next instruction'));
 expect(screen.getByText('Run → OneLedger Capture')).toBeTruthy();
 expect(screen.getByText(/Do not choose the separate shortcut/)).toHaveTextContent(/Ask Each Time/);
 await fireEvent.press(screen.getByText('Next instruction'));
 expect(screen.getByText('Input → Shortcut Input → message text')).toBeTruthy();
 expect(screen.getByRole('alert')).toHaveTextContent(/Cancel it/);
 await fireEvent.press(screen.getByText('Next instruction'));
 expect(screen.getByText('Automation ON · Confirm Before Run OFF')).toBeTruthy();
 await fireEvent.press(screen.getByText('Next instruction'));
 expect(screen.getByText('Connection test first · incoming message next')).toBeTruthy();
 expect(next).not.toHaveBeenCalled();
 await fireEvent.press(screen.getByText('I’ve saved the trigger'));expect(next).toHaveBeenCalledTimes(1);
});
it('keeps older iOS instructions separate and lets the user switch layout', async () => {
 await render(<AutomationGuide majorVersion={26} onNext={()=>{}}/>);
 expect(screen.getByText('Create a Message automation')).toBeTruthy();
 await fireEvent.press(screen.getByText('iOS 27'));
 expect(screen.getByText('Open your Message automation')).toBeTruthy();
});
it('opens the Shortcuts library instead of running Capture without a message',async()=>{
 const open=jest.spyOn(Linking,'openURL').mockResolvedValue(true as never);
 await render(<AutomationGuide majorVersion={27} onNext={()=>{}}/>);
 await fireEvent.press(screen.getByRole('button',{name:'Open Shortcuts'}));
 expect(open).toHaveBeenCalledWith('shortcuts://');open.mockRestore();
});
