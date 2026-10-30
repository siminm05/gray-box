# GrayBox

A simple browser-based image processing application built with HTML and JavaScript, based on an original C image-processing project.

**🌐 Live Demo:** [Try GrayBox](https://siminm05.github.io/gray-box/)

**📂 Source Code:** [GitHub Repository](https://github.com/siminm05/gray-box)

The project started as a C based image processing project and was later extended with a simple web interface.

## Features
- Upload PNG, JPG and PGM images
- Convert colour images to grayscale
- Average filter (3×3)
- Mean filter (4×4)
- Median filter (3×3)
- Sobel edge detection
- Prewitt edge detection
- Local Binary Patterns (LBP)
- Nearest - neighbour image resizing
- Download processed images in PGM format

## Technologies Used
- HTML
- JavaScript
- C (original image processing implementation)


## Note
The current browser version uses JavaScript implementations of the image processing algorithms. The original C implementation is being retained separately, with WebAssembly integration planned as a future improvement.
