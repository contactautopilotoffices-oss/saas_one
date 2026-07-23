import barcode
from barcode.writer import ImageWriter
import os
import sys

def generate_barcode(item_id, output_path):
    """
    Generates a Code128 barcode for a given item_id and saves it as a PNG.
    """
    try:
        # Code128 is robust for alphanumeric strings
        CODE128 = barcode.get_barcode_class('code128')
        
        # Ensure the directory exists
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        
        # Create the barcode with ImageWriter to support PNG
        # display_value=True adds the text label below the bars
        my_barcode = CODE128(item_id, writer=ImageWriter())
        
        # Configuration for the barcode look
        options = {
            'module_height': 15.0,
            'module_width': 0.2,
            'font_size': 10,
            'text_distance': 5.0,
            'quiet_zone': 6.5,
        }
        
        # Save the image (ImageWriter automatically adds .png)
        # Note: output_path should be just the base name
        my_barcode.save(output_path, options)
        print(f"Barcode successfully saved to: {output_path}.png")
        return True
    except Exception as e:
        print(f"Error generating barcode: {str(e)}")
        return False

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python qr_gen.py <item_id> <output_path_without_extension>")
        sys.exit(1)
        
    identifier = sys.argv[1]
    output_path = sys.argv[2]
    
    success = generate_barcode(identifier, output_path)
    if not success:
        sys.exit(1)
