import { canOfferWelcome, coachPlacement, emptyGuides, guidePanelLimits, guideStorageKey, readGuides } from "../model";
import { GUIDE_GROUPS, GUIDE_REVISION, guideDefinitions, guideStepIndex, nextStepIndex } from "../definitions";
describe("task guide structure and progress", () => {
  const definitions = guideDefinitions(false);
  it("keeps every guide focused on one task with two to four steps", () => {
    expect(definitions[0].id).toBe("orientation"); expect(definitions[0].steps).toHaveLength(3);
    for (const guide of definitions) {
      expect(guide.steps.length).toBeGreaterThanOrEqual(2);
      expect(guide.steps.length).toBeLessThanOrEqual(4);
      expect(GUIDE_GROUPS).toContain(guide.group);
      expect(new Set(guide.steps.map(step => step.id)).size).toBe(guide.steps.length);
    }
    expect(definitions.some(guide => /whole app|full tour|complete platform/i.test(guide.description))).toBe(false);
  });
  it("splits reports from statements and finding activity from understanding its details", () => {
    expect(definitions.find(g => g.id === "documents")!.steps.map(s => s.route)).toEqual(["/more", "/reports"]);
    expect(definitions.find(g => g.id === "statements")!.steps.map(s => s.route)).toEqual(["/more", "/statements"]);
    expect(definitions.find(g => g.id === "transaction")!.steps).toHaveLength(3);
    expect(definitions.find(g => g.id === "details")!.steps).toHaveLength(2);
  });
  it("uses device-appropriate recording setup without installing or enabling anything", () => {
    expect(guideDefinitions(true).find(g => g.id === "recording")!.steps[1].route).toBe("/shortcuts");
    expect(definitions.find(g => g.id === "recording")!.steps[1].route).toBe("/connect");
  });
  it("discards corrupt state and reads stable task progress without adopting a long-tour position", () => {
    for (const raw of ["null", "{", JSON.stringify({version:2})]) expect(readGuides(raw)).toEqual(emptyGuides());
    const guide = definitions.find(g => g.id === "statements")!;
    const progress = { status: "paused", revision: GUIDE_REVISION, step: 1, stepId: guide.steps[1].id };
    const value = readGuides(JSON.stringify({...emptyGuides(),progress:{statements:progress}}));
    expect(guideStepIndex(guide,value.progress.statements,false)).toBe(1);
    expect(guideStepIndex(definitions[0],{status:"paused",revision:2,step:54,stepId:"appearance-page"},false)).toBe(0);
    expect(guideStepIndex(guide,progress,true)).toBe(0);
  });
  it("isolates identity and only automatically invites new accounts", () => {
    expect(guideStorageKey("a")).not.toBe(guideStorageKey("b"));
    const now=Date.parse("2026-11-22T10:00:00Z");
    expect(canOfferWelcome("2026-11-21T10:00:00Z",now)).toBe(true);
    for(const date of [undefined,"bad","2020-01-01","2030-01-01"]) expect(canOfferWelcome(date,now)).toBe(false);
  });
  it("skips a detail pointer if no actual record can be opened", () => {
    const detail = definitions.find(g=>g.id==='details')!;
    expect(nextStepIndex(detail.steps,0)).toBe(detail.steps.length);
  });
});
describe("compact coach placement", () => {
  const viewport={width:375,height:812,top:44,bottom:34};
  it("caps width and height so the page stays visible",()=>{
    for(const height of [480,640,812,1024]){
      const limits=guidePanelLimits({...viewport,height});
      expect(limits.width).toBeLessThanOrEqual(320);
      expect(limits.maxHeight).toBeLessThanOrEqual((height-44-34-24)*.44);
      expect(limits.maxHeight).toBeLessThanOrEqual(300);
    }
  });
  it("places above a bottom control and below a header control",()=>{
    const above=coachPlacement({x:80,y:700,width:60,height:44},viewport,210);
    expect(above.side).toBe('above');expect(above.top+210).toBeLessThan(above.spot.y);
    const below=coachPlacement({x:250,y:50,width:44,height:44},viewport,210);
    expect(below.side).toBe('below');expect(below.top).toBeGreaterThan(below.spot.y+below.spot.height);
  });
  it("can sit beside an item on a wide viewport",()=>{
    const result=coachPlacement({x:650,y:200,width:50,height:44},{width:1000,height:450,top:24,bottom:24},180);
    expect(result.side).toBe('left');
    expect(result.left+result.width).toBeLessThan(result.spot.x);
  });
  it("focuses the heading of a large section instead of blanketing it",()=>{
    const result=coachPlacement({x:16,y:150,width:340,height:480},viewport,210);
    expect(result.side).toBe('below');expect(result.spot.height).toBe(64);
  });
  it("keeps a clipped-target fallback compact and within safe bounds",()=>{
    const result=coachPlacement({x:16,y:-100,width:340,height:180},viewport,800);
    const limits=guidePanelLimits(viewport);
    expect(result.side).toBe('sheet');
    expect(result.top+limits.maxHeight).toBeLessThanOrEqual(viewport.height-viewport.bottom);
  });
});
