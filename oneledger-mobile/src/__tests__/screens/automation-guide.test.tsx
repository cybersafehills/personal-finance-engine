import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { AutomationGuide } from '@/features/ios-shortcuts/AutomationGuide';
it('guides iOS 27 through the installed shortcut, filter repair and background settings', async () => {
 const next=jest.fn();await render(<AutomationGuide majorVersion={27} onNext={next}/>);
 expect(screen.getByText('Open your Message automation')).toBeTruthy();
 expect(screen.queryByText(/Run Immediately/)).toBeNull();
 await fireEvent.press(screen.getByText('Next instruction'));
 expect(screen.getByText('One condition: Message contains RWF')).toBeTruthy();
 await fireEvent.press(screen.getByText('I can’t find this'));
 expect(screen.getByText(/The warning “Configure Sender”/)).toBeTruthy();
 await fireEvent.press(screen.getByText('Next instruction'));
 expect(screen.getByText('Run Shortcut: OneLedger Capture · Input: received message')).toBeTruthy();
 await fireEvent.press(screen.getByText('Next instruction'));
 expect(screen.getByText('Automation ON · Confirm Before Run OFF')).toBeTruthy();
 expect(next).not.toHaveBeenCalled();
 await fireEvent.press(screen.getByText('I’ve saved the trigger'));expect(next).toHaveBeenCalledTimes(1);
});
it('keeps older iOS instructions separate and lets the user switch layout', async () => {
 await render(<AutomationGuide majorVersion={26} onNext={()=>{}}/>);
 expect(screen.getByText('Create a Message automation')).toBeTruthy();
 await fireEvent.press(screen.getByText('iOS 27'));
 expect(screen.getByText('Open your Message automation')).toBeTruthy();
});

it('opens the Shortcuts library on iOS 27',async()=>{
 const open=jest.spyOn(Linking,'openURL').mockResolvedValue(true as never);
 await render(<AutomationGuide majorVersion={27} onNext={()=>{}}/>);
 await fireEvent.press(screen.getByRole('button',{name:'Open Shortcuts'}));
 expect(open).toHaveBeenCalledWith('shortcuts://');open.mockRestore();
});
