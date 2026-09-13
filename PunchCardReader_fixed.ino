/* PunchCardReader
   Arduining.com 29/06/2011
   Updated for modern Arduino IDE/core compatibility
*/
#define  clock  8   //clock input on digital pin 8.
#define  data   9   //data input on digital pin 9.
byte Byte;          //store the incoming 8 bits.

void setup() {
  pinMode(clock, INPUT_PULLUP);   // sets pin mode AND enables internal pull-up
  pinMode(data, INPUT_PULLUP);
  Serial.begin(9600);
}

void loop() {
  Byte = 0;
  while (digitalRead(clock) == 0);      //wait for card in (rising edge).
  delay(20);                            //debounce
  for (int i = 0; i < 8; i++) {
    while (digitalRead(clock) == 1) {}; //wait for a falling edge.
    delay(20);                          //debounce
    while (digitalRead(clock) == 0);    //wait for a rising edge.
    delay(20);                          //debounce
    Byte = Byte << 1;
    Byte = Byte | !(digitalRead(data));
    Serial.print(!(digitalRead(data)));
  }
  while (digitalRead(clock) == 1) {};   //wait for card out.
  delay(20);                            //debounce
  Serial.print(" = ");
  Serial.println(Byte, DEC);            // BYTE format removed in modern cores; DEC replaces it
}
