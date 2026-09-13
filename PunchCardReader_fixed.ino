/* PunchCardReader
   Arduining.com 29/06/2011
   Updated for modern Arduino IDE/core compatibility
*/
#define clock 8
#define data 9

byte Byte;

void setup() {
  pinMode(clock, INPUT_PULLUP);
  pinMode(data, INPUT_PULLUP);
  Serial.begin(9600);
}

void loop() {
  Byte = 0;

  while (digitalRead(clock) == 0);
  delay(20);

  for (int i = 0; i < 8; i++) {
    while (digitalRead(clock) == 1) {}
    delay(20);

    while (digitalRead(clock) == 0);
    delay(20);

    Byte = Byte << 1;
    Byte = Byte | !(digitalRead(data));

    Serial.print(!(digitalRead(data)));
  }

  while (digitalRead(clock) == 1) {}
  delay(20);

  Serial.print(" = ");
  Serial.println(Byte, DEC);
}
