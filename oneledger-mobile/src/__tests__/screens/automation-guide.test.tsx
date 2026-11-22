import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { AutomationGuide } from '@/features/ios-shortcuts/AutomationGuide';
it('guides iOS 27 through the installed shortcut, filter repair and background settings', async () => {
 const next=jest.fn();await render(<AutomationGuide majorVersion={27} onNext={next}/>);
 expect(screen.getByText('Open the installed shortcut')).toBeTruthy();
 expect(screen.queryByText(/Run Immediately/)).toBeNull();
 await fireEvent.press(screen.getByText('Next instruction'));
 expect(screen.getByText('Message  contains  RWF')).toBeTruthy();
 await fireEvent.press(screen.getByText('I can’t find this'));
 expect(screen.getByText(/Seeing “Configure Sender”/)).toBeTruthy();
 await fireEvent.press(screen.getByText('Next instruction'));
 expect(screen.getByText('Automation ON · Confirm Before Run OFF')).toBeTruthy();
 expect(next).not.toHaveBeenCalled();
 await fireEvent.press(screen.getByText('I’ve saved the trigger'));expect(next).toHaveBeenCalledTimes(1);
});
it('keeps older iOS instructions separate and lets the user switch layout', async () => {
 await render(<AutomationGuide majorVersion={26} onNext={()=>{}}/>);
 expect(screen.getByText('Create a Message automation')).toBeTruthy();
 await fireEvent.press(screen.getByText('iOS 27'));
 expect(screen.getByText('Open the installed shortcut')).toBeTruthy();
});

it('opens the installed shortcut directly on iOS 27',async()=>{
 const open=jest.spyOn(Linking,'openURL').mockResolvedValue(true as never);
 await render(<AutomationGuide majorVersion={27} onNext={()=>{}}/>);
 await fireEvent.press(screen.getByRole('button',{name:'Open OneLedger Capture'}));
 expect(open).toHaveBeenCalledWith('shortcuts://open-shortcut?name=OneLedger%20Capture');open.mockRestore();
});
