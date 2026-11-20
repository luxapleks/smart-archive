// cfb/oxmsg importeren 'fs' alleen voor bestands-I/O die we niet gebruiken
export default {};
export const readFileSync = () => { throw new Error("fs niet beschikbaar in de browser"); };
export const writeFileSync = readFileSync;
